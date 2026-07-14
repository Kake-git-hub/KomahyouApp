/* eslint-disable no-useless-escape */
// このファイルは埋め込み実行スクリプト(クライアントJS)をテンプレートリテラル内の文字列として生成する。
// 文字列中の正規表現エスケープ(\s, \" 等)は出力コードのために意図的であり、no-useless-escape の
// 自動修正で外すと埋め込みスクリプトが壊れて実行時に全停止する(memory: komahyou-schedulehtml-embedded-script)。
// そのためこのルールはファイル単位で無効化する。エスケープは絶対に変更しない。
import { compareStudentsByCurrentGradeThenName, getReferenceDateKey, getStudentDisplayName, getTeacherDisplayName, isActiveOnDate, resolveCurrentStudentGradeLabel, type StudentRow, type TeacherRow } from '../components/basic-data/basicDataModel'
import { isRegularLessonParticipantActiveOnDate, resolveOperationalSchoolYear, resolveRegularLessonParticipantPeriod, type RegularLessonRow } from '../components/basic-data/regularLessonModel'
import { buildRegularLessonsFromTemplate, type RegularLessonTemplate } from '../components/regular-template/regularLessonTemplate'
import type { SpecialSessionRow } from '../components/special-data/specialSessionModel'
import type { ScheduleCountAdjustmentEntry } from '../types/appState'
import type { SlotCell, StudentEntry } from '../components/schedule-board/types'
import type { ClassroomSettings } from '../types/appState'
import { buildLinkedLessonDestinationMap } from '../components/schedule-board/lessonLinks'
import { buildDeskPickerDesks, type DeskPickerDesk } from '../components/schedule-view/scheduleViewMove'
import { normalizeGroupClassEntryMap, type GroupClassEntryMap } from '../components/schedule-board/groupClass'
import { generateQrSvg } from './qrcode'
import { buildSubmissionUrl } from './scheduleQrConfig'
import { resolveDisplayedSubjectForGrade } from './studentGradeSubject'

const scheduleQrSvgCache = new Map<string, string>()

function normalizeStudentNameLookupKey(value: string) {
  return value.replace(/\s+/gu, '').trim()
}

function parseDateKey(dateKey: string) {
  return new Date(`${dateKey}T00:00:00`)
}

// Serialized* / SchedulePayload 型と build*Payload は、生成HTML(印刷/PDF)と React 日程表ビュー
// (scheduleViewData.ts / ScheduleView)が共有する表示算出の正本。二重定義で表示をズラさないため、
// React ビュー側はこの payload を入力として使う(spec-schedule-interactive-view §C-3)。
export type SerializedStudent = {
  id: string
  name: string
  fullName: string
  currentGradeLabel: string
  currentGradeOrder: number
  birthDate: string
  entryDate: string
  withdrawDate: string
  submissionToken?: string
  qrSvg?: string
  submissionSubmitted?: boolean
  // オプション欄(開発用教室): QR提出のチェック状態。キー=行番号('0'..'4') -> true。
  optionChecks?: Record<string, boolean>
}

export type SerializedTeacher = {
  id: string
  name: string
  fullName?: string
  entryDate: string
  withdrawDate: string
  subjects: string[]
  submissionToken?: string
  qrSvg?: string
  submissionSubmitted?: boolean
}

export type SerializedStudentEntry = {
  id: string
  linkedStudentId?: string
  name: string
  grade: string
  subject: string
  lessonType: string
  teacherType: string
  manualAdded: boolean
  makeupSourceLabel?: string
  warning?: string
}

export type SerializedStudentStatusEntry = {
  id: string
  linkedStudentId?: string
  name: string
  grade: string
  subject: string
  lessonType: string
  teacherType: string
  teacherName: string
  makeupSourceDate?: string
  makeupSourceLabel?: string
  recordedAt: string
  status: 'absent' | 'absent-no-makeup' | 'attended'
  noteSuffix?: string
  linkedDestinationDateKey?: string
  linkedDestinationSlotNumber?: number
}

export type SerializedCell = {
  dateKey: string
  dateLabel: string
  dayLabel: string
  slotNumber: number
  slotLabel: string
  timeLabel: string
  isOpenDay: boolean
  desks: Array<{
    teacher: string
    teacherId?: string
    regularTeacherIds?: string[]
    statuses?: SerializedStudentStatusEntry[]
    lesson?: {
      note?: string
      students: SerializedStudentEntry[]
    }
  }>
  // 日程表コマ組み(別タブD&D)専用: このコマの全机(空席含む)の席レイアウト。机選択モーダルの表示に使う。
  // serializeCells の includeDeskPicker=true(=対話用の生徒ペイロード・DnD有効時)のときだけ載る。
  // 印刷/講師/全員表示のペイロードには載せない(印刷経路のバイト増を避ける)。空席の机を落とす desks とは別に持つ。
  pickerDesks?: DeskPickerDesk[]
}

export type SerializedStudentSpecialSessionInput = {
  unavailableSlots: string[]
  subjectSlots: Record<string, number>
  // spec-schedule-pdf §E: 科目ごとの授業時間(60/45分)。講習回数表の科目名に併記する(未配置の希望科目でも表示)。
  subjectDurations?: Record<string, number>
  // spec-group-lesson §C/§E: 集団授業の参加(科目→true)。登録後の生徒日程表の出し分けと回数(集理/集社)に使う。
  groupClassParticipation?: Record<string, boolean>
  // オプション欄(開発用教室): QR提出のチェック状態。キー=行番号('0'..'4') -> true。
  optionChecks?: Record<string, boolean>
  regularOnly: boolean
  countSubmitted: boolean
  submissionToken?: string
  // 講習集計結果の「提出日時」「提出方法」列に使う。QR提出/室長登録の日時と方法('qr'|'manual')。
  // 未搬送(既存データ)や未登録は undefined。payload に必ず載せる(欠落すると popup で '—' に化ける)。
  submittedAt?: string | null
  submissionMethod?: 'qr' | 'manual'
}

export type SerializedTeacherSpecialSessionInput = {
  unavailableSlots: string[]
  countSubmitted: boolean
  submissionToken?: string
  // 講師の講習集計結果でも提出日時/方法を表示する。生徒と同じ扱い。
  submittedAt?: string | null
  submissionMethod?: 'qr' | 'manual'
}

export type SerializedSpecialSession = {
  id: string
  label: string
  startDate: string
  endDate: string
  teacherInputs: Record<string, SerializedTeacherSpecialSessionInput>
  studentInputs: Record<string, SerializedStudentSpecialSessionInput>
}

export type SerializedExpectedRegularOccurrence = {
  linkedStudentId: string
  subject: string
  dateKey: string
}

export type SerializedScheduleCountAdjustment = {
  studentKey: string
  subject: string
  countKind: 'regular' | 'special'
  dateKey: string
  delta: number
}

export type SchedulePayload = {
  titleLabel: string
  defaultStartDate: string
  defaultEndDate: string
  defaultPeriodValue: string
  defaultPersonId?: string
  availableStartDate: string
  availableEndDate: string
  availability: Pick<ClassroomSettings, 'closedWeekdays' | 'holidayDates' | 'forceOpenDates'>
  periodBands: Array<{ id?: string; label: string; startDate: string; endDate: string }>
  students: SerializedStudent[]
  teachers: SerializedTeacher[]
  cells: SerializedCell[]
  scheduleNotes: Record<string, string>
  expectedRegularOccurrences: SerializedExpectedRegularOccurrence[]
  highlightedStudentSlot?: {
    studentId: string
    studentName?: string
    studentDisplayName?: string
    dateKey: string
    slotNumber: number
  }
  highlightedTeacherId?: string
  countAdjustments: SerializedScheduleCountAdjustment[]
  specialSessions: SerializedSpecialSession[]
  // spec-group-lesson §A/§E: 盤面の集団授業割当(key=`${dateKey}_${band}`)。生徒/講師日程表の集団行・回数・給与に使う。
  groupClassEntries: GroupClassEntryMap
  classroomStorageKey: string
  // タブ名に表示する教室名(2026-07-09)。
  classroomName: string
  showSubmittedQr?: boolean
  // 生徒日程表のオプション欄(休み欄を置き換え/振替を左詰め)を有効化する。開発用教室のみ。
  optionFieldEnabled?: boolean
  // 日程表コマ組み(別タブD&D)を有効化する(staging/開発用教室のみ)。埋め込みJSがこのフラグで D&D を起動し、
  // true のときだけ各コマに pickerDesks(机選択モーダル用の全机レイアウト)が載る。
  scheduleDndEnabled?: boolean
}

type OpenScheduleHtmlParams = {
  cells: SlotCell[]
  defaultStartDate: string
  defaultEndDate: string
  defaultPeriodValue?: string
  defaultPersonId?: string
  titleLabel: string
  classroomSettings: Pick<ClassroomSettings, 'closedWeekdays' | 'holidayDates' | 'forceOpenDates' | 'scheduleNotes'>
  periodBands?: Pick<SpecialSessionRow, 'id' | 'label' | 'startDate' | 'endDate'>[]
  specialSessions?: SpecialSessionRow[]
  // spec-group-lesson §A: 盤面の集団授業割当。生徒/講師日程表へ集団行・回数・給与として反映する。
  groupClassEntries?: GroupClassEntryMap
  classroomStorageKey?: string
  // タブ名(document.title)に表示する教室名。取り違え防止のため期間ではなく教室名を出す(2026-07-09)。
  classroomName?: string
  targetWindow?: Window | null
  lazyQrLoading?: boolean
  showSubmittedQr?: boolean
  // 生徒日程表のオプション欄を有効化する(開発用教室のみ)。
  optionFieldEnabled?: boolean
  // 日程表コマ組み(別タブD&D)を有効化する(staging/開発用教室のみ)。生徒ペイロードにのみ渡す。
  scheduleDndEnabled?: boolean
}

type ScheduleQrRuntimeWindow = Window & typeof globalThis & {
  __buildScheduleQrSvg?: (token?: string) => string | undefined
}

export function buildSubmissionQrSvg(token: string | undefined) {
  if (!token) return undefined
  const url = buildSubmissionUrl(token)
  if (!url) return undefined
  const cached = scheduleQrSvgCache.get(token)
  if (cached) return cached
  const svg = generateQrSvg(url, 52)
  scheduleQrSvgCache.set(token, svg)
  return svg
}

function registerScheduleQrBuilder() {
  if (typeof window === 'undefined') return
  ;(window as ScheduleQrRuntimeWindow).__buildScheduleQrSvg = buildSubmissionQrSvg
}

function findOverlappingSession(specialSessions: SpecialSessionRow[] | undefined, startDate: string, endDate: string) {
  if (!specialSessions?.length) return { session: undefined, error: undefined }
  const overlapping = specialSessions.filter((s) => s.startDate <= endDate && s.endDate >= startDate)
  if (overlapping.length === 0) return { session: undefined, error: undefined }
  if (overlapping.length > 1) return { session: undefined, error: '複数の講習期間が重複しています。QRを表示できません。' }
  return { session: overlapping[0], error: undefined }
}

export type OpenStudentScheduleHtmlParams = OpenScheduleHtmlParams & {
  students: StudentRow[]
  regularLessons: RegularLessonRow[]
  regularLessonTemplateHistory?: RegularLessonTemplate[]
  preTemplateRegularLessons?: RegularLessonRow[]
  teachers?: TeacherRow[]
  scheduleCountAdjustments?: ScheduleCountAdjustmentEntry[]
  highlightedStudentSlot?: {
    studentId: string
    studentName?: string
    studentDisplayName?: string
    dateKey: string
    slotNumber: number
  } | null
}

export type OpenTeacherScheduleHtmlParams = OpenScheduleHtmlParams & {
  teachers: TeacherRow[]
  students?: StudentRow[]
  regularLessons?: RegularLessonRow[]
  regularLessonTemplateHistory?: RegularLessonTemplate[]
  preTemplateRegularLessons?: RegularLessonRow[]
  highlightedTeacherId?: string | null
}

export type OpenAllScheduleHtmlParams = OpenScheduleHtmlParams & {
  students: StudentRow[]
  teachers: TeacherRow[]
  regularLessons: RegularLessonRow[]
  regularLessonTemplateHistory?: RegularLessonTemplate[]
  preTemplateRegularLessons?: RegularLessonRow[]
  scheduleCountAdjustments?: ScheduleCountAdjustmentEntry[]
  targetWindowName?: string
}

function serializeCells(
  cells: SlotCell[],
  resolveLinkedStudentId?: (studentName: string) => string | undefined,
  resolveRegularTeacherIds?: (student: StudentEntry, cell: SlotCell) => string[],
  options?: { includeDeskPicker?: boolean },
): SerializedCell[] {
  const linkedDestinationByStatusId = buildLinkedLessonDestinationMap(cells)

  return cells
    .slice()
    .sort((left, right) => {
      if (left.dateKey !== right.dateKey) return left.dateKey.localeCompare(right.dateKey)
      return left.slotNumber - right.slotNumber
    })
    .map((cell) => ({
      dateKey: cell.dateKey,
      dateLabel: cell.dateLabel,
      dayLabel: cell.dayLabel,
      slotNumber: cell.slotNumber,
      slotLabel: cell.slotLabel,
      timeLabel: cell.timeLabel,
      isOpenDay: cell.isOpenDay,
      // 日程表コマ組み(別タブD&D)専用: 机選択モーダルは移動先コマの「全机(空席含む)」が要るが、
      // 下の desks は空席の机を落とす(line: !lesson && statuses空 → null)。そこで開校日に限り、盤面の
      // 全机レイアウト(既存テスト済みの buildDeskPickerDesks)を pickerDesks として別に載せる(印刷経路は不変)。
      ...(options?.includeDeskPicker && cell.isOpenDay ? { pickerDesks: buildDeskPickerDesks(cell) } : {}),
      desks: cell.desks.map((desk) => {
        const statuses = desk.statusSlots
          ?.filter((entry): entry is Exclude<NonNullable<typeof entry>, { status: 'moved' }> => !!entry && entry.status !== 'moved')
          .map((entry) => {
            const linkedDestination = linkedDestinationByStatusId.get(entry.id)
            return {
              id: entry.id,
              linkedStudentId: entry.managedStudentId ?? resolveLinkedStudentId?.(entry.name),
              name: entry.name,
              grade: entry.grade,
              subject: resolveDisplayedSubjectForGrade(entry.subject, entry.grade),
              lessonType: entry.lessonType,
              teacherType: entry.teacherType,
              teacherName: entry.teacherName,
              makeupSourceDate: entry.makeupSourceDate,
              makeupSourceLabel: entry.makeupSourceLabel,
              recordedAt: entry.recordedAt,
              status: entry.status as SerializedStudentStatusEntry['status'],
              noteSuffix: entry.noteSuffix,
              linkedDestinationDateKey: linkedDestination?.dateKey,
              linkedDestinationSlotNumber: linkedDestination?.slotNumber,
            }
          })
        const lesson = desk.lesson
          ? {
              note: desk.lesson.note,
              students: desk.lesson.studentSlots
                .filter((student): student is NonNullable<typeof student> => Boolean(student))
                .map((student) => ({
                  id: student.id,
                  // 体験授業の生徒は同名であっても既存生徒として扱わない
                  linkedStudentId: student.lessonType === 'trial' ? undefined : student.managedStudentId ?? resolveLinkedStudentId?.(student.name),
                  name: student.name,
                  grade: student.grade,
                  subject: resolveDisplayedSubjectForGrade(student.subject, student.grade),
                  lessonType: student.lessonType,
                  teacherType: student.teacherType,
                  manualAdded: Boolean(student.manualAdded),
                  makeupSourceLabel: student.makeupSourceLabel,
                  warning: student.warning,
                })),
            }
          : undefined
        if (!lesson && (!statuses || statuses.length === 0)) return null
        const regularTeacherIds = Array.from(new Set(
          (desk.lesson?.studentSlots ?? []).flatMap((student) => student ? resolveRegularTeacherIds?.(student, cell) ?? [] : []),
        ))
        return {
          teacher: desk.teacher,
          teacherId: desk.teacherAssignmentTeacherId,
          ...(regularTeacherIds.length > 0 ? { regularTeacherIds } : {}),
          statuses,
          lesson,
        }
      }).filter((desk): desk is NonNullable<typeof desk> => desk !== null),
    }))
}

function createPopupWindow(targetName: string, targetWindow?: Window | null) {
  const openedWindow = window.open('', targetName)
  if (openedWindow) return openedWindow
  if (targetWindow && !targetWindow.closed) {
    targetWindow.focus()
    return targetWindow
  }
  return null
}

function startOfMonth(dateKey: string) {
  const [year, month] = dateKey.split('-').map(Number)
  return new Date(year, (month || 1) - 1, 1)
}

function toDateKey(date: Date) {
  const year = date.getFullYear()
  const month = `${date.getMonth() + 1}`.padStart(2, '0')
  const day = `${date.getDate()}`.padStart(2, '0')
  return `${year}-${month}-${day}`
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

function getScheduledDatesInMonth(year: number, monthIndex: number, dayOfWeek: number) {
  const dates: string[] = []
  const cursor = new Date(year, monthIndex, 1)

  while (cursor.getMonth() === monthIndex) {
    if (cursor.getDay() === dayOfWeek) dates.push(toDateKey(cursor))
    cursor.setDate(cursor.getDate() + 1)
  }

  return dates
}

export function buildExpectedRegularOccurrences(params: {
  students: StudentRow[]
  regularLessons: RegularLessonRow[]
  startDate: string
  endDate: string
}) {
  const { students, regularLessons, startDate, endDate } = params
  const studentById = new Map(students.map((student) => [student.id, student]))
  const occurrences: SerializedExpectedRegularOccurrence[] = []
  const seen = new Set<string>()

  for (const row of regularLessons) {
    const participants = [
      { studentId: row.student1Id, subject: row.subject1 },
      { studentId: row.student2Id, subject: row.subject2 },
    ].filter((entry) => entry.studentId && entry.subject)

    for (const participant of participants) {
      const student = studentById.get(participant.studentId)
      if (!student) continue

      // Always iterate the full participant period so the popup receives all
      // expected occurrences regardless of the current cell/display range.
      // The popup filters by its own selected date range.
      const participantPeriod = resolveRegularLessonParticipantPeriod(row)
      const periodStart = participantPeriod.startDate || startDate
      const periodEnd = participantPeriod.endDate || endDate
      if (periodEnd < periodStart) continue

      for (const { year, monthIndex } of iterateMonthsInRange(periodStart, periodEnd)) {
        const monthScheduledDates = getScheduledDatesInMonth(year, monthIndex, row.dayOfWeek)
          .filter((dateKey) => isActiveOnDate(student.entryDate, student.withdrawDate, student.birthDate, dateKey))

        for (const dateKey of monthScheduledDates) {
          if (dateKey < periodStart || dateKey > periodEnd) continue
          const dedupKey = `${student.id}|${dateKey}|${participant.subject}`
          if (seen.has(dedupKey)) continue
          seen.add(dedupKey)
          occurrences.push({ linkedStudentId: student.id, subject: participant.subject, dateKey })
        }
      }
    }
  }

  return occurrences.sort((left, right) => (
    left.linkedStudentId.localeCompare(right.linkedStudentId)
    || left.dateKey.localeCompare(right.dateKey)
    || left.subject.localeCompare(right.subject, 'ja')
  ))
}

function createBasePayload(params: OpenScheduleHtmlParams, linkedStudents: StudentRow[] = []): Omit<SchedulePayload, 'students' | 'teachers'> {
  const linkedStudentIdByName = new Map<string, string>()
  const addLinkedStudentLookup = (key: string, studentId: string) => {
    const normalizedKey = normalizeStudentNameLookupKey(key)
    if (!normalizedKey) return
    const current = linkedStudentIdByName.get(normalizedKey)
    if (current && current !== studentId) {
      linkedStudentIdByName.set(normalizedKey, '')
      return
    }
    if (current === '') return
    linkedStudentIdByName.set(normalizedKey, studentId)
  }
  linkedStudents.forEach((student) => {
    const displayName = getStudentDisplayName(student)
    addLinkedStudentLookup(student.name, student.id)
    addLinkedStudentLookup(displayName, student.id)
  })
  const resolveLinkedStudentId = (studentName: string) => linkedStudentIdByName.get(normalizeStudentNameLookupKey(studentName)) || undefined
  const paramsWithRegularLessons = params as OpenScheduleHtmlParams & {
    regularLessons?: RegularLessonRow[]
    regularLessonTemplateHistory?: RegularLessonTemplate[]
    preTemplateRegularLessons?: RegularLessonRow[]
    teachers?: TeacherRow[]
    students?: StudentRow[]
  }
  const teacherLookupRegularLessons = paramsWithRegularLessons.regularLessons
    ? buildCombinedRegularLessonsFromHistory({
        regularLessons: paramsWithRegularLessons.regularLessons,
        regularLessonTemplateHistory: paramsWithRegularLessons.regularLessonTemplateHistory,
        preTemplateRegularLessons: paramsWithRegularLessons.preTemplateRegularLessons,
        teachers: paramsWithRegularLessons.teachers,
        students: paramsWithRegularLessons.students ?? linkedStudents,
      })
    : []
  const resolveRegularTeacherIds = (student: StudentEntry, cell: SlotCell) => {
    if (student.lessonType !== 'regular') return []
    // 盤面移動でこのコマに配置された生徒(同日移動・元コマへ戻した振替)は、基本データ行の
    // 担当講師ではなく実際に置かれた机の講師(名前/teacherId)に帰属させる。これを欠くと、
    // 同コマ内で別講師の机へ移した生徒が基本データ行(曜日・時限が一致し続ける)経由で
    // 旧講師の講師日程にも二重表示される(2026-07-04 報告)。
    if (student.sameDayMoveSourceDate === cell.dateKey || student.makeupSourceDate === cell.dateKey) return []
    const studentId = student.managedStudentId ?? resolveLinkedStudentId(student.name)
    if (!studentId || teacherLookupRegularLessons.length === 0) return []
    const lessonDate = parseDateKey(cell.dateKey)
    const schoolYear = resolveOperationalSchoolYear(lessonDate)
    const dayOfWeek = lessonDate.getDay()
    return teacherLookupRegularLessons
      .filter((row) => row.schoolYear === schoolYear && row.dayOfWeek === dayOfWeek && row.slotNumber === cell.slotNumber)
      .flatMap((row) => {
        const subject1Matches = row.subject1 === student.subject || resolveDisplayedSubjectForGrade(row.subject1, student.grade) === student.subject
        const subject2Matches = row.subject2 === student.subject || resolveDisplayedSubjectForGrade(row.subject2, student.grade) === student.subject
        if (row.student1Id === studentId && subject1Matches && isRegularLessonParticipantActiveOnDate(row, cell.dateKey)) return [row.teacherId]
        if (row.student2Id === studentId && subject2Matches && isRegularLessonParticipantActiveOnDate(row, cell.dateKey)) return [row.teacherId]
        return []
      })
      .filter(Boolean)
  }
  // 監査領域9 A1(2026-07-04 確定): plannedCells payload は撤去済み。planned 通常回数の唯一の根拠は
  // expectedRegularOccurrences(テンプレ由来)で、plannedCells は埋め込みJSから一度も読まれないデッドだった。
  const serializedCells = serializeCells(params.cells, resolveLinkedStudentId, resolveRegularTeacherIds, { includeDeskPicker: Boolean(params.scheduleDndEnabled) })
  const availableStartDate = serializedCells[0]?.dateKey ?? params.defaultStartDate
  const availableEndDate = serializedCells[serializedCells.length - 1]?.dateKey ?? params.defaultEndDate

  return {
    titleLabel: params.titleLabel,
    defaultStartDate: params.defaultStartDate,
    defaultEndDate: params.defaultEndDate,
    defaultPeriodValue: params.defaultPeriodValue || '',
    defaultPersonId: params.defaultPersonId || '',
    availableStartDate,
    availableEndDate,
    availability: {
      closedWeekdays: [...params.classroomSettings.closedWeekdays],
      holidayDates: [...params.classroomSettings.holidayDates],
      forceOpenDates: [...params.classroomSettings.forceOpenDates],
    },
    periodBands: (params.periodBands ?? []).map((period) => ({
      id: 'id' in period ? period.id : undefined,
      label: period.label,
      startDate: period.startDate,
      endDate: period.endDate,
    })),
    cells: serializedCells,
    scheduleNotes: { ...(params.classroomSettings.scheduleNotes ?? {}) },
    expectedRegularOccurrences: [],
    highlightedStudentSlot: undefined,
    highlightedTeacherId: undefined,
    showSubmittedQr: Boolean(params.showSubmittedQr),
    countAdjustments: [],
    specialSessions: (params.specialSessions ?? []).map((session) => ({
      id: session.id,
      label: session.label,
      startDate: session.startDate,
      endDate: session.endDate,
      teacherInputs: Object.fromEntries(Object.entries(session.teacherInputs).map(([personId, input]) => [personId, {
        unavailableSlots: Array.isArray(input.unavailableSlots) ? [...input.unavailableSlots] : [],
        countSubmitted: Boolean(input.countSubmitted),
        submissionToken: input.submissionToken ?? undefined,
        // 講習集計結果(講師)の提出日時/方法。欠落すると popup へ届かず '—' に化けるため必ず載せる。
        submittedAt: input.submittedAt ?? undefined,
        submissionMethod: input.submissionMethod ?? undefined,
      }])),
      studentInputs: Object.fromEntries(Object.entries(session.studentInputs).map(([personId, input]) => [personId, {
        unavailableSlots: Array.isArray(input.unavailableSlots) ? [...input.unavailableSlots] : [],
        subjectSlots: input.subjectSlots && typeof input.subjectSlots === 'object' ? { ...input.subjectSlots } : {},
        // 講習回数表の授業時間併記(60/45分)に必要。未配置の希望科目でも分数を出すため payload に載せる。
        subjectDurations: input.subjectDurations && typeof input.subjectDurations === 'object' ? { ...input.subjectDurations } : {},
        groupClassParticipation: input.groupClassParticipation && typeof input.groupClassParticipation === 'object' ? { ...input.groupClassParticipation } : {},
        optionChecks: input.optionChecks && typeof input.optionChecks === 'object' ? { ...input.optionChecks } : {},
        regularOnly: Boolean(input.regularOnly),
        countSubmitted: Boolean(input.countSubmitted),
        submissionToken: input.submissionToken ?? undefined,
        // 講習集計結果(生徒)の提出日時/方法。欠落すると popup へ届かず '—' に化けるため必ず載せる。
        submittedAt: input.submittedAt ?? undefined,
        submissionMethod: input.submissionMethod ?? undefined,
      }])),
    })),
    groupClassEntries: normalizeGroupClassEntryMap(params.groupClassEntries),
    classroomStorageKey: params.classroomStorageKey || 'default',
    classroomName: params.classroomName || '',
    optionFieldEnabled: Boolean(params.optionFieldEnabled),
    scheduleDndEnabled: Boolean(params.scheduleDndEnabled),
  }
}

export function buildSerializedScheduleCountAdjustments(params: {
  cells: SlotCell[]
  scheduleCountAdjustments?: ScheduleCountAdjustmentEntry[]
}) {
  const entries = new Map<string, SerializedScheduleCountAdjustment>()

  const appendEntry = (entry: SerializedScheduleCountAdjustment) => {
    const studentKey = String(entry.studentKey || '').trim()
    const subject = String(entry.subject || '').trim()
    const dateKey = String(entry.dateKey || '').trim()
    const delta = Number.isFinite(Number(entry.delta)) ? Math.trunc(Number(entry.delta)) : 0
    if (!studentKey || !subject || !dateKey || delta === 0) return

    const key = `${studentKey}__${subject}__${entry.countKind}__${dateKey}`
    const current = entries.get(key)
    const nextDelta = (current?.delta ?? 0) + delta
    if (nextDelta === 0) {
      entries.delete(key)
      return
    }

    entries.set(key, {
      studentKey,
      subject,
      countKind: entry.countKind,
      dateKey,
      delta: nextDelta,
    })
  }

  params.cells.forEach((cell) => {
    cell.desks.forEach((desk) => {
      desk.lesson?.studentSlots.forEach((student) => {
        if (!student?.manualAdded) return
        if (student.lessonType !== 'special') return
        appendEntry({
          studentKey: student.managedStudentId ?? student.name,
          subject: student.subject,
          countKind: student.lessonType === 'special' ? 'special' : 'regular',
          dateKey: cell.dateKey,
          delta: 1,
        })
      })
    })
  })

  for (const adjustment of params.scheduleCountAdjustments ?? []) {
    appendEntry({
      studentKey: adjustment.studentKey,
      subject: adjustment.subject,
      countKind: adjustment.countKind,
      dateKey: adjustment.dateKey,
      delta: adjustment.delta,
    })
  }

  return Array.from(entries.values()).sort((left, right) => (
    left.studentKey.localeCompare(right.studentKey, 'ja')
    || left.dateKey.localeCompare(right.dateKey)
    || left.countKind.localeCompare(right.countKind)
    || left.subject.localeCompare(right.subject, 'ja')
  ))
}

function dayBefore(dateKey: string): string {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(year, (month || 1) - 1, (day || 1))
  date.setDate(date.getDate() - 1)
  return toDateKey(date)
}

export function buildCombinedRegularLessonsFromHistory(params: {
  regularLessons: RegularLessonRow[]
  regularLessonTemplateHistory?: RegularLessonTemplate[]
  preTemplateRegularLessons?: RegularLessonRow[]
  teachers?: TeacherRow[]
  students: StudentRow[]
}): RegularLessonRow[] {
  const { regularLessons, regularLessonTemplateHistory, preTemplateRegularLessons, teachers, students } = params
  if (!regularLessonTemplateHistory || regularLessonTemplateHistory.length === 0) return regularLessons

  const allTemplates = [...regularLessonTemplateHistory].sort((a, b) => a.effectiveStartDate.localeCompare(b.effectiveStartDate))
  const firstTemplateStartDate = allTemplates[0].effectiveStartDate

  // テンプレ適用前の通常授業を最初のテンプレ開始日前にクリップして結合
  const preTemplateLessons: RegularLessonRow[] = []
  if (preTemplateRegularLessons?.length) {
    const clipEndDate = dayBefore(firstTemplateStartDate)
    if (clipEndDate >= '2000-01-01') {
      for (const lesson of preTemplateRegularLessons) {
        if (lesson.startDate && lesson.startDate > clipEndDate) continue
        preTemplateLessons.push({
          ...lesson,
          endDate: (!lesson.endDate || lesson.endDate > clipEndDate) ? clipEndDate : lesson.endDate,
          student2EndDate: (!lesson.student2EndDate || lesson.student2EndDate > clipEndDate) ? clipEndDate : lesson.student2EndDate,
        })
      }
    }
  }

  if (allTemplates.length === 1) {
    return [...preTemplateLessons, ...regularLessons]
  }

  const combinedLessons: RegularLessonRow[] = [...preTemplateLessons]

  for (let i = 0; i < allTemplates.length; i++) {
    const template = allTemplates[i]
    const nextTemplate = allTemplates[i + 1]
    const lessons = buildRegularLessonsFromTemplate({ template, teachers: teachers ?? [], students })

    if (nextTemplate) {
      const clipEndDate = dayBefore(nextTemplate.effectiveStartDate)
      for (const lesson of lessons) {
        if (lesson.startDate > clipEndDate) continue
        combinedLessons.push({
          ...lesson,
          endDate: lesson.endDate > clipEndDate ? clipEndDate : lesson.endDate,
          student2EndDate: lesson.student2EndDate > clipEndDate ? clipEndDate : lesson.student2EndDate,
        })
      }
    } else {
      combinedLessons.push(...lessons)
    }
  }

  return combinedLessons
}

export function buildStudentPayload(params: OpenStudentScheduleHtmlParams): SchedulePayload {
  const basePayload = createBasePayload(params, params.students)
  const effectiveRegularLessons = buildCombinedRegularLessonsFromHistory({
    regularLessons: params.regularLessons,
    regularLessonTemplateHistory: params.regularLessonTemplateHistory,
    preTemplateRegularLessons: params.preTemplateRegularLessons,
    teachers: params.teachers,
    students: params.students,
  })
  const expectedRegularOccurrences = buildExpectedRegularOccurrences({
    students: params.students,
    regularLessons: effectiveRegularLessons,
    startDate: basePayload.availableStartDate,
    endDate: basePayload.availableEndDate,
  })

  const currentReferenceDate = getReferenceDateKey(new Date())
  const overlappingResult = findOverlappingSession(params.specialSessions, params.defaultStartDate, params.defaultEndDate)
  const targetSession = overlappingResult.session

  return {
    ...basePayload,
    expectedRegularOccurrences,
    highlightedStudentSlot: params.highlightedStudentSlot ?? undefined,
    countAdjustments: buildSerializedScheduleCountAdjustments({
      cells: params.cells,
      scheduleCountAdjustments: params.scheduleCountAdjustments,
    }),
    students: params.students
      .slice()
      .sort((left, right) => compareStudentsByCurrentGradeThenName(left, right, currentReferenceDate))
      .map((student) => {
        const studentInput = targetSession?.studentInputs[student.id]
        const submissionToken = studentInput?.submissionToken
        return {
          id: student.id,
          name: getStudentDisplayName(student),
          fullName: student.name,
          currentGradeLabel: resolveCurrentStudentGradeLabel(student, currentReferenceDate),
          currentGradeOrder: (() => {
            const gradeLabel = resolveCurrentStudentGradeLabel(student, currentReferenceDate)
            if (gradeLabel === '未就学') return 0
            const elementaryMatch = gradeLabel.match(/^小(\d+)$/)
            if (elementaryMatch) return Number(elementaryMatch[1])
            const middleMatch = gradeLabel.match(/^中(\d+)$/)
            if (middleMatch) return 100 + Number(middleMatch[1])
            const highMatch = gradeLabel.match(/^高(\d+)$/)
            if (highMatch) return 200 + Number(highMatch[1])
            if (gradeLabel === '退塾') return 901
            return 999
          })(),
          birthDate: student.birthDate,
          entryDate: student.entryDate,
          withdrawDate: student.withdrawDate,
          submissionToken,
          qrSvg: params.lazyQrLoading ? undefined : buildSubmissionQrSvg(submissionToken),
          submissionSubmitted: Boolean(studentInput?.countSubmitted),
          optionChecks: studentInput?.optionChecks && typeof studentInput.optionChecks === 'object' ? { ...studentInput.optionChecks } : undefined,
        }
      }),
    teachers: [],
  }
}

export function buildTeacherPayload(params: OpenTeacherScheduleHtmlParams): SchedulePayload {
  const basePayload = createBasePayload(params)
  const overlappingResult = findOverlappingSession(params.specialSessions, params.defaultStartDate, params.defaultEndDate)
  const targetSession = overlappingResult.session

  return {
    ...basePayload,
    highlightedTeacherId: params.highlightedTeacherId ?? undefined,
    countAdjustments: [],
    students: [],
    teachers: params.teachers.map((teacher) => {
      const teacherInput = targetSession?.teacherInputs[teacher.id]
      const submissionToken = teacherInput?.submissionToken
      return {
        id: teacher.id,
        name: getTeacherDisplayName(teacher),
        fullName: teacher.name,
        entryDate: teacher.entryDate,
        withdrawDate: teacher.withdrawDate,
        subjects: teacher.subjectCapabilities.map((capability) => `${capability.subject}${capability.maxGrade}`),
        submissionToken,
        qrSvg: params.lazyQrLoading ? undefined : buildSubmissionQrSvg(submissionToken),
        submissionSubmitted: Boolean(teacherInput?.countSubmitted),
      }
    }),
  }
}

function buildAllPayload(params: OpenAllScheduleHtmlParams): SchedulePayload {
  const basePayload = createBasePayload(params, params.students)
  const effectiveRegularLessons = buildCombinedRegularLessonsFromHistory({
    regularLessons: params.regularLessons,
    regularLessonTemplateHistory: params.regularLessonTemplateHistory,
    preTemplateRegularLessons: params.preTemplateRegularLessons,
    teachers: params.teachers,
    students: params.students,
  })
  const expectedRegularOccurrences = buildExpectedRegularOccurrences({
    students: params.students,
    regularLessons: effectiveRegularLessons,
    startDate: basePayload.availableStartDate,
    endDate: basePayload.availableEndDate,
  })

  const currentReferenceDate = getReferenceDateKey(new Date())
  const overlappingResult = findOverlappingSession(params.specialSessions, params.defaultStartDate, params.defaultEndDate)
  const targetSession = overlappingResult.session

  return {
    ...basePayload,
    expectedRegularOccurrences,
    countAdjustments: buildSerializedScheduleCountAdjustments({
      cells: params.cells,
      scheduleCountAdjustments: params.scheduleCountAdjustments,
    }),
    students: params.students
      .slice()
      .sort((left, right) => compareStudentsByCurrentGradeThenName(left, right, currentReferenceDate))
      .map((student) => {
        const studentInput = targetSession?.studentInputs[student.id]
        const submissionToken = studentInput?.submissionToken
        return {
          id: student.id,
          name: getStudentDisplayName(student),
          fullName: student.name,
          currentGradeLabel: resolveCurrentStudentGradeLabel(student, currentReferenceDate),
          currentGradeOrder: (() => {
            const gradeLabel = resolveCurrentStudentGradeLabel(student, currentReferenceDate)
            if (gradeLabel === '未就学') return 0
            const elementaryMatch = gradeLabel.match(/^小(\d+)$/)
            if (elementaryMatch) return Number(elementaryMatch[1])
            const middleMatch = gradeLabel.match(/^中(\d+)$/)
            if (middleMatch) return 100 + Number(middleMatch[1])
            const highMatch = gradeLabel.match(/^高(\d+)$/)
            if (highMatch) return 200 + Number(highMatch[1])
            if (gradeLabel === '退塾') return 901
            return 999
          })(),
          birthDate: student.birthDate,
          entryDate: student.entryDate,
          withdrawDate: student.withdrawDate,
          submissionToken,
          qrSvg: params.lazyQrLoading ? undefined : buildSubmissionQrSvg(submissionToken),
          submissionSubmitted: Boolean(studentInput?.countSubmitted),
          optionChecks: studentInput?.optionChecks && typeof studentInput.optionChecks === 'object' ? { ...studentInput.optionChecks } : undefined,
        }
      }),
    teachers: params.teachers.map((teacher) => {
      const teacherInput = targetSession?.teacherInputs[teacher.id]
      const submissionToken = teacherInput?.submissionToken
      return {
        id: teacher.id,
        name: getTeacherDisplayName(teacher),
        fullName: teacher.name,
        entryDate: teacher.entryDate,
        withdrawDate: teacher.withdrawDate,
        subjects: teacher.subjectCapabilities.map((capability) => `${capability.subject}${capability.maxGrade}`),
        submissionToken,
        qrSvg: params.lazyQrLoading ? undefined : buildSubmissionQrSvg(submissionToken),
        submissionSubmitted: Boolean(teacherInput?.countSubmitted),
      }
    }),
  }
}

// ビューポートに机モーダルを収めるための縮小率(<=1)。高さ・幅の両方で足りない分だけ縮める
// (ブラウザ拡大時は viewport の CSS px が縮むため、固定px寸法の盤面が縦にも横にもはみ出しうる)。
// content<=avail のときは1(拡大しない)。幅の引数を省略すると従来どおり高さのみで判定する。
// 埋め込みJS(openScheduleDeskPicker)側にも同式のミラーがある(new Function文字列内で export 関数を呼べないため)。
export function computeDeskPickerFitScale(
  contentHeight: number,
  viewportHeight: number,
  margin = 24,
  contentWidth?: number,
  viewportWidth?: number,
): number {
  const scales: number[] = []
  if (Number.isFinite(contentHeight) && contentHeight > 0) {
    const availH = Math.max(0, viewportHeight - margin)
    if (availH <= 0) return 1
    scales.push(availH / contentHeight)
  }
  if (
    contentWidth !== undefined &&
    viewportWidth !== undefined &&
    Number.isFinite(contentWidth) &&
    contentWidth > 0
  ) {
    const availW = Math.max(0, viewportWidth - margin)
    if (availW <= 0) return 1
    scales.push(availW / contentWidth)
  }
  if (scales.length === 0) return 1
  return Math.min(1, ...scales)
}

function createScheduleHtml(payload: SchedulePayload, viewType: 'student' | 'teacher' | 'all-student' | 'all-teacher') {
  const serializedPayload = JSON.stringify(payload).replace(/</g, '\\u003c')
  const isAllView = viewType === 'all-student' || viewType === 'all-teacher'
  const viewLabel = viewType === 'student' ? '生徒日程表' : viewType === 'teacher' ? '講師日程表' : viewType === 'all-student' ? '印刷用生徒日程表' : '印刷用講師日程表'

  return `<!doctype html>
<html lang="ja">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>${viewLabel}</title>
    <style>
      :root {
        color-scheme: light;
        --paper: #ffffff;
        --line: #111111;
        --soft-line: #777777;
        --ink: #111111;
        --muted: #666666;
        --sun: #d00000;
        --sat: #003cff;
        --holiday-bg: #d9dde3;
        --header-bg: #f8f8f8;
        --schedule-toolbar-offset: 0px;
      }

      * { box-sizing: border-box; }

      body {
        margin: 0;
        background: #f2f2f2;
        color: var(--ink);
        font-family: 'BIZ UDPGothic', 'Yu Gothic', 'Meiryo', sans-serif;
        scrollbar-width: thin;
        scrollbar-color: #8f9cac #e6ebf2;
      }

      html {
        scrollbar-width: thin;
        scrollbar-color: #8f9cac #e6ebf2;
      }

      html::-webkit-scrollbar,
      body::-webkit-scrollbar,
      .pages::-webkit-scrollbar {
        width: 12px;
        height: 12px;
      }

      html::-webkit-scrollbar-track,
      body::-webkit-scrollbar-track,
      .pages::-webkit-scrollbar-track {
        background: #e6ebf2;
      }

      html::-webkit-scrollbar-thumb,
      body::-webkit-scrollbar-thumb,
      .pages::-webkit-scrollbar-thumb {
        background: #8f9cac;
        border: 2px solid #e6ebf2;
        border-radius: 999px;
      }

      .toolbar {
        position: fixed;
        top: 0;
        left: 0;
        width: 100%;
        z-index: 20;
        display: flex;
        flex-wrap: nowrap;
        gap: 8px;
        align-items: end;
        padding: 6px 12px;
        border-bottom: 1px solid #c9c9c9;
        background: rgba(255, 255, 255, 0.97);
        white-space: nowrap;
        overflow: hidden;
      }

      .toolbar-field {
        display: grid;
        gap: 2px;
        flex-shrink: 1;
        min-width: 0;
      }

      .toolbar-spacer {
        flex: 1 1 auto;
        min-width: 0;
      }

      .toolbar-actions {
        display: flex;
        align-items: end;
        gap: 6px;
        flex-shrink: 0;
      }

      .toolbar-field label,
      .toolbar-summary,
      .toolbar-title {
        font-size: 11px;
        color: var(--muted);
        overflow: hidden;
        text-overflow: ellipsis;
      }

      .interaction-lock-banner {
        margin: 0 16px 12px;
        padding: 10px 14px;
        border: 1px solid #c5d3e4;
        background: #eef4fb;
        color: #244564;
        font-size: 12px;
        line-height: 1.5;
      }

      body.surface-locked .toolbar,
      body.surface-locked .pages {
        opacity: 0.82;
      }

      .toolbar-title {
        flex-shrink: 0;
        font-weight: 700;
        color: var(--ink);
        font-size: 13px;
      }

      .toolbar input {
        min-width: 0;
        width: 130px;
        padding: 5px 6px;
        border: 1px solid #666666;
        border-radius: 0;
        font: inherit;
        font-size: 13px;
      }

      .toolbar-field--search input {
        width: 150px;
      }

      .toolbar select {
        min-width: 0;
        width: 160px;
        padding: 5px 6px;
        border: 1px solid #666666;
        border-radius: 0;
        font: inherit;
        font-size: 13px;
        background: #ffffff;
      }

      .toolbar button {
        height: 32px;
        padding: 0 12px;
        border: 1px solid #333333;
        border-radius: 0;
        background: #ffffff;
        font: inherit;
        font-size: 13px;
        font-weight: 700;
        cursor: pointer;
        color: #111111;
        white-space: nowrap;
      }

      .toolbar button.secondary {
        background: #f3f3f3;
        color: var(--ink);
      }

      .pages {
        display: grid;
        gap: 12px;
        padding: calc(var(--schedule-toolbar-offset) + 12px) 12px 12px;
        justify-content: center;
        align-content: start;
        overflow: auto;
        scrollbar-width: thin;
        scrollbar-color: #8f9cac #e6ebf2;
      }

      body.all-view .pages {
        padding-top: 12px;
      }

      body.all-view .sheet {
        pointer-events: none;
      }

      .sheet {
        background: var(--paper);
        border: 1.5px solid var(--line);
        border-radius: 0;
        padding: 10px;
        box-shadow: none;
        break-inside: avoid;
        width: 277mm;
        aspect-ratio: 297 / 210;
        overflow: hidden;
      }

      .sheet-top {
        display: grid;
        grid-template-columns: 150px 172px minmax(0, 1fr) auto;
        gap: 6px;
        align-items: stretch;
        margin-bottom: 8px;
      }

      .logo-box,
      .school-box,
      .title-box,
      .meta-box {
        border: 0;
        min-height: 44px;
        background: #ffffff;
      }

      .logo-box {
        display: flex;
        align-items: center;
        justify-content: center;
        position: relative;
        overflow: hidden;
        padding: 2px 4px;
        cursor: pointer;
      }

      .logo-placeholder {
        font-size: 11px;
        color: var(--muted);
      }

      .logo-image {
        max-width: 100%;
        max-height: 36px;
        object-fit: contain;
        display: block;
      }

      .school-box {
        display: flex;
        align-items: center;
        justify-content: flex-start;
        padding: 3px 8px;
        min-width: 200px;
      }

      .school-input {
        width: 100%;
        min-height: 34px;
        border: 0;
        outline: 0;
        font: inherit;
        font-size: 13px;
        color: #444444;
        background: transparent;
        resize: none;
        line-height: 1.2;
        white-space: nowrap;
      }

      .title-box {
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 0 10px;
        min-width: 0;
      }

      .title-input {
        width: 100%;
        border: 0;
        outline: 0;
        background: transparent;
        font: inherit;
        font-size: 18px;
        font-weight: 700;
        letter-spacing: 0.02em;
        text-align: center;
      }

      .meta-box {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        padding: 3px 8px;
        gap: 10px;
        font-size: 13px;
        font-weight: 700;
        min-width: 0;
        max-width: 100%;
      }

      .meta-qr-block {
        flex: 0 0 auto;
        display: flex;
        align-items: center;
        line-height: 0;
      }

      .meta-info {
        display: grid;
        align-content: center;
        justify-items: end;
        gap: 2px;
      }

      .meta-row {
        display: flex;
        gap: 10px;
        align-items: center;
        white-space: nowrap;
      }

      .person-meta-row {
        display: flex;
        align-items: center;
        justify-content: flex-end;
        gap: 6px;
        max-width: 100%;
      }

      .meta-label {
        font-weight: 700;
      }

      .page-count {
        color: var(--muted);
        font-weight: 400;
      }

      .print-only-hidden {
        display: inline;
      }

      .qr-code {
        flex: 0 0 auto;
        line-height: 0;
      }

      .qr-code.is-hidden {
        display: none;
      }

      .qr-code svg {
        display: block;
      }

      .submission-badge {
        flex: 0 0 auto;
        display: inline-flex;
        align-items: center;
        justify-content: center;
        width: 52px;
        height: 52px;
        background: #e8f5e8;
        color: #2a7e2a;
        font-size: 10px;
        font-weight: 700;
        border-radius: 4px;
        cursor: pointer;
        border: 1px solid #b5d9b5;
        white-space: nowrap;
        text-align: center;
        line-height: 1.2;
        padding: 2px;
      }

      .submission-badge:hover {
        background: #d0ecd0;
      }

      table.schedule-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }

      .schedule-table th,
      .schedule-table td {
        border: 1.5px solid var(--line);
      }

      .schedule-table thead th {
        background: #ffffff;
        text-align: center;
        padding: 4px 2px;
        font-size: 12px;
      }

      /* A4省スペース(講師日程表のみ): 日付/曜日ヘッダの上下余白を詰めて A3 に飛び出しにくくする。
         生徒日程表(別ドキュメント)には波及させない。 */
      .sheet[data-role="teacher-sheet"] .schedule-table thead th {
        padding-top: 1px;
        padding-bottom: 1px;
      }

      .schedule-table .time-col {
        width: 62px;
        min-width: 62px;
        background: #ffffff;
      }

      .month-row th {
        background: var(--header-bg);
        font-size: 13px;
        padding-top: 2px;
        padding-bottom: 2px;
      }

      .time-corner {
        background: var(--header-bg);
        padding: 0;
      }

      .time-corner-box {
        min-height: 58px;
        display: grid;
        align-content: center;
        justify-items: center;
        gap: 1px;
        padding: 3px 2px;
      }

      .time-corner-year {
        display: block;
        font-size: 11px;
        font-weight: 700;
        line-height: 1.05;
      }

      .period-row th {
        background: #ffffff;
        padding: 3px 2px;
      }

      .period-gap {
        background: #ffffff;
      }

      .period-band {
        background: #fff6cf;
      }

      .period-pill {
        display: flex;
        align-items: center;
        justify-content: space-between;
        gap: 4px;
        min-height: 22px;
        background: #ffe48a;
        color: #5a4200;
        font-size: 12px;
        font-weight: 700;
        border: 1.5px solid #b18d26;
        padding: 0 6px;
      }

      .period-pill-center {
        flex: 1 1 0;
        min-width: 0;
        display: flex;
        align-items: center;
        justify-content: center;
        gap: 6px;
      }

      .period-pill-button {
        width: 100%;
        border: 0;
        margin: 0;
        padding: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }

      .period-pill-button.is-registered .period-pill {
        background: #d8f0d8;
        border-color: #5b8f5b;
        color: #214a21;
      }

      .period-pill-state {
        flex: 0 0 auto;
        font-size: 10px;
        font-weight: 700;
        white-space: nowrap;
      }

      .period-pill-state-inline {
        flex: 0 0 auto;
        font-size: 10px;
        font-weight: 700;
        white-space: nowrap;
        color: #5a4200;
      }

      .count-modal-backdrop {
        position: fixed;
        inset: 0;
        z-index: 40;
        display: flex;
        align-items: center;
        justify-content: center;
        padding: 24px;
        background: rgba(17, 17, 17, 0.28);
      }

      .count-modal {
        width: min(420px, 100%);
        border: 1.5px solid var(--line);
        background: #ffffff;
        box-shadow: 0 10px 30px rgba(0, 0, 0, 0.14);
      }

      .count-modal-head,
      .count-modal-body,
      .count-modal-actions {
        padding: 14px 16px;
      }

      .count-modal-head {
        border-bottom: 1px solid #d7d7d7;
        display: grid;
        gap: 4px;
      }

      .count-modal-title {
        font-size: 16px;
        font-weight: 700;
      }

      .count-modal-subtitle,
      .count-modal-note {
        font-size: 12px;
        color: var(--muted);
      }

      .count-modal-body {
        display: grid;
        gap: 12px;
      }

      .count-modal-table {
        width: 100%;
        border-collapse: collapse;
      }

      .count-modal-table td {
        border: 1px solid #d7d7d7;
        padding: 8px 10px;
        font-size: 13px;
      }

      .count-modal-table input[type="number"] {
        width: 84px;
        padding: 6px 8px;
        border: 1px solid #888888;
        font: inherit;
      }

      .count-modal-duration {
        margin-right: 8px;
        padding: 6px 8px;
        border: 1px solid #888888;
        font: inherit;
        vertical-align: middle;
      }

      .count-modal-check {
        display: inline-flex;
        align-items: center;
        gap: 8px;
      }

      .count-modal-actions {
        border-top: 1px solid #d7d7d7;
        display: flex;
        justify-content: flex-end;
        gap: 8px;
      }

      .period-pill-label {
        flex: 0 0 auto;
        white-space: nowrap;
      }

      .period-pill-edge {
        flex: 0 0 auto;
        font-size: 11px;
        line-height: 1;
      }

      .date-row th {
        font-size: 12px;
        font-weight: 700;
      }

      .date-label,
      .weekday-label {
        display: block;
      }

      .weekday-row th {
        font-size: 12px;
        font-weight: 700;
      }

      .weekday-sun { color: var(--sun); }
      .weekday-sat { color: var(--sat); }

      .holiday-col,
      .slot-cell.is-holiday {
        background: var(--holiday-bg);
      }

      .time-box {
        display: grid;
        align-items: center;
        justify-items: center;
        gap: 2px;
        padding: 2px 2px;
        min-height: 0;
      }

      .time-range {
        display: grid;
        justify-items: center;
        font-size: 10px;
        font-weight: 400;
        line-height: 1.15;
      }

      .time-part,
      .time-separator {
        display: block;
        white-space: nowrap;
      }

      .time-slot {
        font-size: 12px;
        color: var(--ink);
        font-weight: 700;
        line-height: 1.1;
      }

      .header-toggle {
        width: 100%;
        border: 0;
        margin: 0;
        padding: 0;
        background: transparent;
        color: inherit;
        font: inherit;
        cursor: pointer;
      }

      .header-toggle:focus-visible,
      .slot-button:focus-visible {
        outline: 2px solid #2f6fed;
        outline-offset: -2px;
      }

      .header-toggle.is-unavailable {
        background: rgba(17, 17, 17, 0.08);
      }

      .header-toggle.is-pending,
      .slot-button.is-pending {
        cursor: progress;
      }

      .slot-cell {
        /* 講習回数表に集理/集社の2行が増えたぶん、時限の行高を少し詰めて
           A4横シート(overflow:hidden)の下端で集社が見切れないようにする。 */
        height: 53px;
        vertical-align: top;
        background: #fff;
      }

      .slot-cell.is-unavailable {
        background: #d1d6dc;
      }

      /* spec-group-lesson §E: 集団授業の行(中3・1限の上) */
      .group-class-row .group-slot-cell {
        height: 40px;
        background: #fff7ec;
        text-align: center;
        vertical-align: middle;
      }

      .group-class-row .group-slot-cell.is-holiday {
        background: #eef0f3;
      }

      .group-slot-label {
        font-weight: 700;
        font-size: 12px;
        color: #7c3a00;
      }

      .group-slot-absent {
        color: #b00020;
        text-decoration: line-through;
      }

      .group-slot-empty {
        color: #9aa0a6;
        font-weight: 600;
      }

      .slot-cell.is-moving-highlight {
        background: #fff4ad;
        box-shadow: inset 0 0 0 2px #d0a000;
      }

      .slot-cell.is-pending {
        position: relative;
      }

      .slot-cell.is-pending::after {
        content: '';
        width: 14px;
        height: 14px;
        border-radius: 999px;
        border: 2px solid rgba(47, 111, 237, 0.18);
        border-top-color: #2f6fed;
        animation: schedule-spin 0.7s linear infinite;
      }

      .slot-cell.is-pending::after {
        position: absolute;
        left: 50%;
        top: 50%;
        margin-left: -7px;
        margin-top: -7px;
      }

      .slot-cell.is-editable {
        cursor: pointer;
      }

      .slot-cell-content {
        height: 100%;
        padding: 0;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .slot-button,
      .slot-static {
        width: 100%;
        height: 100%;
        min-height: 100%;
        border: 0;
        padding: 3px;
        margin: 0;
        background: transparent;
        display: flex;
        align-items: center;
        justify-content: center;
      }

      .slot-static:has(.lesson-card-teacher),
      .slot-button:has(.lesson-card-teacher) {
        /* A4省スペース: 講師カードのコマは上下左右の余白を詰めて行高を縮める。 */
        padding: 0;
      }

      .slot-button {
        cursor: pointer;
      }

      .slot-button:disabled {
        cursor: default;
      }

      .slot-button.is-unavailable {
        background: rgba(17, 17, 17, 0.06);
      }

      @keyframes schedule-spin {
        to {
          transform: rotate(360deg);
        }
      }

      .lesson-card {
        width: 100%;
        height: 100%;
        display: grid;
        align-content: center;
        justify-items: center;
        gap: 2px;
        padding: 2px 4px;
        border: 0;
        background: transparent;
      }

      .lesson-card-stack {
        width: 100%;
        height: 100%;
        display: grid;
        grid-auto-rows: minmax(0, 1fr);
        overflow: hidden;
      }

      .lesson-card-stack-item {
        min-height: 0;
        overflow: hidden;
      }

      .lesson-card-stack-item + .lesson-card-stack-item {
        border-top: 1px solid rgba(17, 17, 17, 0.28);
      }

      .lesson-card-stack .lesson-card {
        padding: 1px 2px;
        gap: 0;
      }

      .lesson-card-teacher {
        align-items: stretch;
        justify-items: stretch;
        gap: 0;
        padding: 1px 0;
        overflow: hidden;
      }

      .lesson-card-teacher.is-single {
        grid-template-columns: 1fr;
      }

      .lesson-card-teacher.is-pair {
        grid-template-columns: repeat(2, minmax(0, 1fr));
      }

      .lesson-card-teacher.is-multi {
        grid-template-columns: repeat(2, minmax(0, 1fr));
        grid-auto-rows: minmax(0, 1fr);
      }

      .teacher-lesson-person {
        box-sizing: border-box;
        width: 100%;
        min-width: 0;
        min-height: 100%;
        display: flex;
        align-items: center;
        justify-content: center;
        /* A4省スペース: 名前と科目/種別/状態(メタ)の間の空きと、上下の余白を詰める。 */
        gap: 0;
        padding: 0;
        writing-mode: vertical-rl;
        text-orientation: upright;
        overflow: hidden;
      }

      .lesson-card-teacher.is-pair .teacher-lesson-person {
        gap: 0;
        padding: 0;
      }

      .lesson-card-teacher.is-multi .teacher-lesson-person {
        min-height: 0;
        gap: 0;
        padding: 0;
      }

      .teacher-lesson-line {
        display: block;
        line-height: 1;
        text-align: center;
        white-space: nowrap;
      }

      .teacher-lesson-name {
        font-size: 12px;
        font-weight: 700;
      }

      .teacher-lesson-meta {
        font-size: 9px;
      }

      /* 生徒1人(is-single)も2人(is-pair)と同じ文字サイズに統一(1人だけ大きくして余白を取らない)。 */
      .teacher-lesson-person.is-condensed .teacher-lesson-name,
      .lesson-card-teacher.is-single .teacher-lesson-name,
      .lesson-card-teacher.is-pair .teacher-lesson-name {
        font-size: 10px;
      }

      .teacher-lesson-person.is-condensed .teacher-lesson-meta,
      .lesson-card-teacher.is-single .teacher-lesson-meta,
      .lesson-card-teacher.is-pair .teacher-lesson-meta {
        font-size: 7px;
      }

      .teacher-lesson-person.is-ultra-condensed .teacher-lesson-name {
        font-size: 9px;
      }

      .teacher-lesson-person.is-ultra-condensed .teacher-lesson-meta {
        font-size: 6px;
      }

      .lesson-main {
        font-size: 13px;
        font-weight: 700;
        line-height: 1.1;
        text-align: center;
      }

      .lesson-sub {
        font-size: 11px;
        line-height: 1.1;
        text-align: center;
      }

      .lesson-footnote {
        font-size: 9px;
        color: var(--muted);
        text-align: center;
      }

      .schedule-table.is-compact .lesson-main {
        font-size: 11px;
      }

      .schedule-table.is-compact .lesson-sub {
        font-size: 9px;
      }

      .schedule-table.is-dense .lesson-main {
        font-size: 10px;
      }

      .schedule-table.is-dense .lesson-sub {
        font-size: 8px;
      }

      .schedule-table.is-dense .lesson-card {
        gap: 1px;
        padding: 1px 2px;
      }

      .schedule-table.is-compact .teacher-lesson-name {
        font-size: 11px;
      }

      .schedule-table.is-compact .teacher-lesson-meta {
        font-size: 9px;
      }

      .schedule-table.is-compact .lesson-card-teacher.is-single .teacher-lesson-name,
      .schedule-table.is-compact .lesson-card-teacher.is-pair .teacher-lesson-name {
        font-size: 9px;
      }

      .schedule-table.is-compact .lesson-card-teacher.is-single .teacher-lesson-meta,
      .schedule-table.is-compact .lesson-card-teacher.is-pair .teacher-lesson-meta {
        font-size: 7px;
      }

      .schedule-table.is-dense .teacher-lesson-name {
        font-size: 10px;
      }

      .schedule-table.is-dense .teacher-lesson-meta {
        font-size: 8px;
      }

      .schedule-table.is-dense .lesson-card-teacher.is-single .teacher-lesson-name,
      .schedule-table.is-dense .lesson-card-teacher.is-pair .teacher-lesson-name {
        font-size: 8px;
      }

      .schedule-table.is-dense .lesson-card-teacher.is-single .teacher-lesson-meta,
      .schedule-table.is-dense .lesson-card-teacher.is-pair .teacher-lesson-meta {
        font-size: 6px;
      }

      .schedule-table.is-dense .date-row th,
      .schedule-table.is-dense .weekday-row th {
        font-size: 10px;
      }

      .schedule-table.is-ultra-dense .lesson-main {
        font-size: 8px;
      }

      .schedule-table.is-ultra-dense .lesson-sub {
        font-size: 7px;
      }

      .schedule-table.is-ultra-dense .lesson-card {
        gap: 0;
        padding: 0 1px;
      }

      .schedule-table.is-ultra-dense .teacher-lesson-name {
        font-size: 8px;
      }

      .schedule-table.is-ultra-dense .teacher-lesson-meta {
        font-size: 7px;
      }

      .schedule-table.is-ultra-dense .lesson-card-teacher.is-single .teacher-lesson-name,
      .schedule-table.is-ultra-dense .lesson-card-teacher.is-pair .teacher-lesson-name {
        font-size: 7px;
      }

      .schedule-table.is-ultra-dense .lesson-card-teacher.is-single .teacher-lesson-meta,
      .schedule-table.is-ultra-dense .lesson-card-teacher.is-pair .teacher-lesson-meta {
        font-size: 5px;
      }

      .schedule-table.is-ultra-dense .date-row th,
      .schedule-table.is-ultra-dense .weekday-row th {
        font-size: 8px;
      }

      .empty-label {
        width: 100%;
        height: 100%;
      }

      .closed-label {
        display: grid;
        place-items: center;
        height: 100%;
        font-size: 12px;
        color: var(--muted);
      }

      .bottom-grid {
        display: grid;
        grid-template-columns: minmax(0, 1.35fr) minmax(0, 1.35fr) 168px 206px 246px;
        gap: 8px;
        margin-top: 10px;
        align-items: start;
      }

      /* Part2/3(A4省スペース): 振替授業欄(206px)を削除し、空いた分を給与計算欄へ回して横に広げる。
         給与は 2 列レイアウト(.salary-columns)で縦に伸びず、A4 横に収まりやすくする。 */
      .bottom-grid.bottom-grid-teacher {
        grid-template-columns: minmax(0, 1fr) 246px;
      }

      /* オプション欄あり: 休み欄(168px)を削除し、振替授業を左へ、空いた所にオプション欄を置く。
         振替授業欄は従来比4/5(206→165px)に狭め、空いた分は可変幅の連絡事項2列が吸収して広がる。 */
      .bottom-grid.bottom-grid-option {
        grid-template-columns: minmax(0, 1.35fr) minmax(0, 1.35fr) 165px 190px 246px;
      }

      /* オプション欄あり: 連絡事項(共通/個別)のテキストは周囲より2px小さく表示する。 */
      .bottom-grid.bottom-grid-option .box-textarea {
        font-size: calc(1em - 2px);
      }

      .box-panel {
        border: 1.5px solid var(--line);
        background: #ffffff;
      }

      .box-stack {
        display: grid;
        align-content: start;
      }

      .box-stack .box-panel {
        border-top: 0;
      }

      .panel-title {
        font-size: 12px;
        margin-bottom: 2px;
      }

      .box-textarea {
        width: 100%;
        min-height: 124px;
        border: 0;
        padding: 6px 8px;
        resize: none;
        font: inherit;
      }

      .salary-section {
        font-size: 11px;
      }
      .salary-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 11px;
        table-layout: fixed;
      }
      .salary-table col.salary-col-label { width: auto; }
      .salary-table col.salary-col-count { width: 64px; }
      .salary-table col.salary-col-unit { width: 80px; }
      .salary-table col.salary-col-sub { width: 72px; }
      /* Part3: 給与計算を横2列に振り分けて縦幅を節約する。各列は等幅で伸縮。 */
      .salary-columns {
        display: flex;
        gap: 6px;
        align-items: flex-start;
      }
      .salary-columns .salary-table { flex: 1 1 0; min-width: 0; }
      /* 2列は各列が半幅になりラベル(例: B 90-90 (2名/中学以下/90+90分))が切れやすい。
         数値列・単価入力を細くしフォントを1px詰めて、ラベルを1行に収める。 */
      .salary-columns .salary-table { font-size: 10px; }
      .salary-columns col.salary-col-count { width: 40px; }
      .salary-columns col.salary-col-unit { width: 58px; }
      .salary-columns col.salary-col-sub { width: 52px; }
      .salary-columns .salary-input { width: 48px; font-size: 10px; }
      .salary-table-foot { border-top: 0; }
      .salary-table th, .salary-table td {
        border: 1px solid var(--line);
        padding: 2px 4px;
        text-align: right;
        white-space: nowrap;
      }
      .salary-table th {
        background: var(--bg);
        text-align: center;
        font-weight: normal;
      }
      .salary-table .salary-label {
        text-align: left;
        font-weight: 600;
      }
      .salary-input {
        width: 64px;
        border: 1px solid var(--line);
        padding: 1px 3px;
        font: inherit;
        font-size: 11px;
        text-align: right;
      }
      .salary-total-row td {
        font-weight: 600;
        background: #fafafa;
      }

      /* 給与計算の行が多くA4横では見切れる講師ページは A3 縦へ自動切替して全行を表示する。
         A3縦は幅がA4横と同じ(297mm)なので週グリッドの横レイアウトは保ったまま縦だけ伸ばせる。 */
      .sheet.is-a3-portrait {
        aspect-ratio: 297 / 420;
      }

      .check-line {
        display: flex;
        gap: 6px;
        align-items: center;
        padding: 6px 8px 2px;
        font-size: 12px;
      }

      .count-table {
        width: 100%;
        border-collapse: collapse;
        font-size: 12px;
      }

      .count-table,
      .absence-table,
      .makeup-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
      }

      .count-table {
        border-bottom: 1.5px solid var(--line);
      }

      /* オプション欄(2列5行)。左列=学年共通テキスト入力、右列=チェック1文字分。 */
      .option-table {
        width: 100%;
        border-collapse: collapse;
        table-layout: fixed;
        border: 1.5px solid var(--line);
        border-top: 0;
      }
      .option-table col.option-col-check { width: 20px; }
      .option-table td {
        border: 1px solid var(--line);
        padding: 0;
        height: 24px;
        vertical-align: middle;
      }
      .option-input {
        width: 100%;
        min-height: 22px;
        height: 24px;
        border: 0;
        padding: 2px 5px;
        font: inherit;
        font-size: 11px;
        box-sizing: border-box;
        background: transparent;
      }
      .option-check-cell {
        text-align: center;
        font-size: 13px;
        font-weight: 700;
        line-height: 1;
      }

      .count-table th,
      .count-table td,
      .absence-table th,
      .absence-table td,
      .makeup-table th,
      .makeup-table td {
        border: 1.5px solid var(--line);
        padding: 3px 4px;
        text-align: center;
        height: 22px;
      }

      .absence-table td,
      .makeup-table td {
        font-size: 9px;
        line-height: 1.05;
        padding: 2px 3px;
        height: 17px;
        white-space: nowrap;
        overflow: hidden;
        text-overflow: ellipsis;
        text-align: left;
      }

      .count-table tbody tr:last-child td {
        border-bottom: 1.5px solid var(--line);
      }

      .count-stack {
        display: grid;
        grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
        gap: 8px;
        align-content: start;
      }

      .count-stack-block {
        display: grid;
        align-content: start;
        gap: 6px;
      }

      .count-warning-stamp {
        border: 2px solid #c3342f;
        color: #c3342f;
        font-size: 11px;
        font-weight: 800;
        line-height: 1.2;
        text-align: center;
        padding: 4px 4px;
        background: rgba(255, 244, 244, 0.94);
        transform: rotate(-4deg);
        letter-spacing: 0.04em;
      }

      .box-table-title {
        border: 1.5px solid var(--line);
        border-bottom: 0;
        text-align: center;
        font-size: 12px;
        font-weight: 700;
        padding: 4px 6px;
      }

      .empty-state {
        padding: 44px 18px;
        text-align: center;
        color: var(--muted);
        border: 1.5px dashed var(--soft-line);
        background: rgba(255, 255, 255, 0.86);
      }

      /* 盤面編集→別タブ反映までの数秒間、最前面に大きく出す同期中スピナー(自動同期のフィードバック)。 */
      .schedule-sync-overlay {
        position: fixed;
        inset: 0;
        z-index: 99999;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 20px;
        background: rgba(244, 247, 250, 0.72);
      }
      .schedule-sync-overlay[hidden] { display: none; }
      .schedule-sync-spinner {
        width: 92px;
        height: 92px;
        border: 11px solid #c3d0e0;
        border-top-color: #1a73e8;
        border-radius: 50%;
        animation: schedule-sync-spin 0.9s linear infinite;
      }
      .schedule-sync-text {
        font-size: 24px;
        font-weight: 800;
        color: #16385c;
        letter-spacing: 0.04em;
        text-shadow: 0 1px 0 rgba(255, 255, 255, 0.9);
      }
      @keyframes schedule-sync-spin { to { transform: rotate(360deg); } }

      /* 日程表コマ組み(別タブD&D・spec-student-schedule-dnd)。scheduleDndEnabled 時のみ授業カードに .is-draggable が付く。 */
      .lesson-card.is-draggable {
        cursor: grab;
        touch-action: none;
      }
      .lesson-card.is-draggable:active { cursor: grabbing; }
      /* ドラッグ中に掴んだ元カードを半透明にする。 */
      .lesson-card.is-drag-origin { opacity: 0.35; }
      /* ドロップ可能な空きコマ(開校日・当該生徒が空き)の青枠ハイライト(盤面D&Dと同系統)。 */
      .slot-cell.is-drop-target {
        outline: 2px solid #2f6fed;
        outline-offset: -2px;
        background: #eaf1ff;
        cursor: copy;
      }
      /* ポインタに追従するドラッグゴースト。 */
      .schedule-drag-ghost {
        position: fixed;
        z-index: 100000;
        pointer-events: none;
        padding: 4px 8px;
        border-radius: 6px;
        background: #1a73e8;
        color: #fff;
        font-size: 12px;
        font-weight: 700;
        box-shadow: 0 4px 12px rgba(0, 0, 0, 0.28);
        transform: translate(-50%, -50%);
        white-space: nowrap;
      }
      /* 机選択モーダル(移動先コマの全机をコマ表と同じ配置で表示)。 */
      .desk-picker-overlay {
        position: fixed;
        inset: 0;
        z-index: 100001;
        display: flex;
        align-items: center;
        justify-content: center;
        background: rgba(17, 24, 39, 0.44);
      }
      .desk-picker-overlay[hidden] { display: none; }
      .desk-picker-modal {
        background: #fff;
        border-radius: 10px;
        padding: 18px 20px;
        max-width: 92vw;
        overflow: visible;
        /* 中央基点で縮小する。center top だと縦長時に flex 中央寄せでボックス上端が画面外へ出た状態から
           上基点で縮むため上端が切れてはみ出す(ブラウザ拡大時に顕在化)。center 基点なら必ず画面内に収まる。 */
        transform-origin: center center;
        box-shadow: 0 12px 40px rgba(0, 0, 0, 0.35);
      }
      /* 盤面の一コマをそのまま切り取った見た目(App.css の .slot-adjust-grid / sa-* に合わせる)。
         上=日付行・左=時限列・各行=机([机番号][講師][席1][席2])。ダーク1pxの罫線・寸法を盤面と揃える。 */
      .desk-picker-board {
        border-collapse: collapse;
        margin: 0 auto;
        background: #fff;
        table-layout: fixed;
      }
      .desk-picker-board td,
      .desk-picker-board th {
        border: 1px solid #111111;
        padding: 2px 4px;
        text-align: center;
        height: 38px;
        font-size: 11px;
        overflow: hidden;
        text-overflow: ellipsis;
      }
      .desk-picker-board .dp-corner { width: 52px; background: #f4f4f4; }
      .desk-picker-board .dp-datehead { background: #f4f4f4; color: #111111; font-size: 12px; font-weight: 700; height: 24px; }
      .desk-picker-board .dp-time {
        width: 52px;
        background: #f4f4f4;
        color: #111111;
        font-size: 11px;
        font-weight: 700;
        line-height: 1.2;
      }
      .desk-picker-board .dp-time-range { font-size: 9px; font-weight: 400; color: #555555; }
      .desk-picker-board .dp-seatno {
        width: 22px;
        background: #f7f7f7;
        color: #333333;
        font-size: 15px;
        font-weight: 800;
        line-height: 1;
        letter-spacing: -0.06em;
      }
      .desk-picker-board .dp-teacher {
        width: 68px;
        font-size: 10px;
        font-weight: 700;
        color: #294967;
        white-space: nowrap;
      }
      .desk-picker-board .dp-student {
        width: 96px;
        background: #fff;
        color: #1f2937;
        white-space: nowrap;
      }
      .desk-picker-board .dp-student.dp-selectable { cursor: pointer; color: #1a56c4; font-weight: 700; }
      .desk-picker-board .dp-selectable .dp-empty { color: #9aa7b6; font-weight: 700; }
      .desk-picker-board .dp-selectable:hover { background: #dbe9ff; }
      .desk-picker-board .dp-selectable:hover .dp-empty { color: #1a56c4; }
      .desk-picker-board .dp-student.dp-occupied { background: #f3f5f8; color: #33404f; }
      /* 在席=クリックで入れ替え(盤面の入れ替えと同じ)。ホバーで橙・「入替」ヒントを出す。 */
      .desk-picker-board .dp-student.dp-swap { cursor: pointer; }
      .desk-picker-board .dp-swap:hover { background: #ffe6c2; }
      .desk-picker-board .dp-swap-hint { display: block; font-size: 8px; font-weight: 700; color: #a15c00; letter-spacing: 0.06em; }
      .desk-picker-board .dp-student.dp-blocked { background: #f6f7f9; color: #9aa0a6; font-style: italic; }
      .desk-picker-actions { margin-top: 14px; display: flex; justify-content: flex-end; }
      .desk-picker-cancel {
        border: 1px solid #c3ccd8;
        background: #fff;
        border-radius: 6px;
        padding: 6px 14px;
        font-size: 13px;
        cursor: pointer;
      }

      /* 移動が成立しなかったときに理由を大きく出す最前面オーバーレイ(「日程表に戻る」で閉じる)。 */
      .move-error-overlay {
        position: fixed;
        inset: 0;
        z-index: 100002;
        display: flex;
        flex-direction: column;
        align-items: center;
        justify-content: center;
        gap: 22px;
        padding: 24px;
        background: rgba(40, 12, 12, 0.55);
      }
      .move-error-overlay[hidden] { display: none; }
      .move-error-card {
        background: #fff;
        border: 3px solid #c3342f;
        border-radius: 14px;
        padding: 28px 32px;
        max-width: 90vw;
        text-align: center;
        box-shadow: 0 16px 48px rgba(0, 0, 0, 0.4);
      }
      .move-error-heading { font-size: 22px; font-weight: 800; color: #b00020; margin: 0 0 12px; letter-spacing: 0.03em; }
      .move-error-reason { font-size: 20px; font-weight: 700; color: #2b1414; line-height: 1.5; }
      .move-error-back {
        border: 0;
        background: #1a73e8;
        color: #fff;
        border-radius: 8px;
        padding: 12px 26px;
        font-size: 18px;
        font-weight: 800;
        cursor: pointer;
      }
      .move-error-back:hover { background: #1560c4; }

      /* 移動が完了したコマを数秒黄色でハイライト(盤面の is-moving-highlight と同系統)。 */
      .slot-cell.is-move-done-highlight {
        background: #fff4ad !important;
        box-shadow: inset 0 0 0 2px #d0a000;
        transition: background 0.2s ease;
      }

      @media print {
        *,
        *::before,
        *::after {
          -webkit-print-color-adjust: exact !important;
          print-color-adjust: exact !important;
        }
        html, body {
          background: #fff;
          overflow: hidden;
          scrollbar-width: none;
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        html::-webkit-scrollbar,
        body::-webkit-scrollbar,
        .pages::-webkit-scrollbar {
          width: 0;
          height: 0;
          display: none;
        }
        .toolbar { display: none; }
        .pages {
          padding: 0;
          gap: 0;
          overflow: visible;
          scrollbar-width: none;
        }
        .print-only-hidden { display: none; }
        .sheet,
        .holiday-col,
        .slot-cell.is-holiday,
        .slot-cell.is-unavailable,
        .slot-button.is-unavailable,
        .header-toggle.is-unavailable {
          -webkit-print-color-adjust: exact;
          print-color-adjust: exact;
        }
        .holiday-col,
        .slot-cell.is-holiday {
          background: var(--holiday-bg) !important;
          box-shadow: inset 0 0 0 999px var(--holiday-bg);
        }
        .slot-cell.is-unavailable,
        .slot-button.is-unavailable,
        .header-toggle.is-unavailable {
          background: #d1d6dc !important;
          box-shadow: inset 0 0 0 999px #d1d6dc;
        }
        .sheet {
          box-shadow: none;
          border: 0;
          padding: 0;
          width: 277mm;
          height: 190mm;
          aspect-ratio: 297 / 210;
          overflow: hidden;
          page-break-after: always;
        }
        /* 給与計算が見切れる講師ページのみ A3 縦で出力する(他ページはA4横のまま)。 */
        .sheet.is-a3-portrait {
          width: 281mm;
          height: 404mm;
          aspect-ratio: 297 / 420;
          page: sheetA3;
        }
        /* 講習回数の科目が多い生徒が A4横シート(height:190mm; overflow:hidden)の下端で
           見切れるのを防ぐため、通常回数・講習回数表の行高を印刷時だけ少し詰める
           (欄の行高さ縮小・オーナー要望 2026-07-08)。画面表示は 22px のまま。 */
        .count-table th,
        .count-table td {
          height: 16px;
          padding: 1px 4px;
          line-height: 1.05;
        }
        .teacher-lesson-person {
          gap: 0;
          padding: 0;
        }
        .teacher-lesson-name {
          font-size: 10px;
        }
        .teacher-lesson-meta {
          font-size: 7px;
        }
        .lesson-card-teacher.is-single .teacher-lesson-name,
        .lesson-card-teacher.is-pair .teacher-lesson-name {
          font-size: 8px;
        }
        .lesson-card-teacher.is-single .teacher-lesson-meta,
        .lesson-card-teacher.is-pair .teacher-lesson-meta {
          font-size: 6px;
        }
        .schedule-table.is-dense .lesson-card-teacher.is-single .teacher-lesson-name,
        .schedule-table.is-dense .lesson-card-teacher.is-pair .teacher-lesson-name {
          font-size: 7px;
        }
        .schedule-table.is-dense .lesson-card-teacher.is-single .teacher-lesson-meta,
        .schedule-table.is-dense .lesson-card-teacher.is-pair .teacher-lesson-meta {
          font-size: 5px;
        }
        .schedule-table.is-ultra-dense .lesson-card-teacher.is-single .teacher-lesson-name,
        .schedule-table.is-ultra-dense .lesson-card-teacher.is-pair .teacher-lesson-name {
          font-size: 6px;
        }
        .schedule-table.is-ultra-dense .lesson-card-teacher.is-single .teacher-lesson-meta,
        .schedule-table.is-ultra-dense .lesson-card-teacher.is-pair .teacher-lesson-meta {
          font-size: 4px;
        }
      }

      @page {
        size: A4 landscape;
        margin: 8mm;
      }

      /* 給与計算が多い講師ページ用(.sheet.is-a3-portrait が参照)。 */
      @page sheetA3 {
        size: A3 portrait;
        margin: 8mm;
      }
    </style>
  </head>
  <body${isAllView ? ' class="all-view"' : ''}>
    ${isAllView ? '' : `<div class="toolbar">
      <div class="toolbar-field">
        <label for="schedule-start-date">開始日</label>
        <input id="schedule-start-date" type="date" />
      </div>
      <div class="toolbar-field">
        <label for="schedule-end-date">終了日</label>
        <input id="schedule-end-date" type="date" />
      </div>
      <div class="toolbar-field">
        <label for="schedule-period-select">登録された講習期間を表示する</label>
        <select id="schedule-period-select">
          <option value="">選択してください</option>
        </select>
      </div>
      <div class="toolbar-spacer"></div>
      <div class="toolbar-actions">
        ${viewType === 'student' ? '<button type="button" id="schedule-empty-format-button" class="secondary">空フォーマット印刷</button>' : ''}
        ${viewType === 'student' || viewType === 'teacher' ? '<button type="button" id="schedule-lecture-summary-button" class="secondary" style="display:none;">講習集計結果</button>' : ''}
        <button type="button" id="schedule-show-all-button" class="secondary">印刷用全員表示</button>
      </div>
      <div class="toolbar-field toolbar-field--search">
        <label for="schedule-person-search">${viewType === 'student' ? '生徒名検索' : '講師名検索'}</label>
        <input id="schedule-person-search" type="search" placeholder="${viewType === 'student' ? '生徒名を検索' : '講師名を検索'}" />
      </div>
      <div class="toolbar-field">
        <label for="schedule-person-select">${viewType === 'student' ? '生徒選択' : '講師選択'}</label>
        <select id="schedule-person-select">
          <option value="">選択してください</option>
        </select>
      </div>
      <div class="toolbar-actions">
        <button type="button" id="schedule-apply-button" title="選択した期間・生徒/講師の絞り込みを適用し、コマ表(盤面)の最新の出欠・振替などを取り込んで表示を更新します">最新表示</button>
      </div>
    </div>`}
    <main class="pages" id="schedule-pages"></main>
    <input id="schedule-logo-input" type="file" accept="image/*" style="display:none" />
    <div id="schedule-sync-overlay" class="schedule-sync-overlay print-only-hidden" hidden><div class="schedule-sync-spinner"></div><div class="schedule-sync-text">コマ表の最新を反映中…</div></div>
    <script id="schedule-data" type="application/json">${serializedPayload}</script>
    <script>
      const VIEW_TYPE = '${viewType}';
      const VIEW_LABEL = '${viewLabel}';
      const BASE_VIEW_TYPE = VIEW_TYPE === 'all-student' ? 'student' : VIEW_TYPE === 'all-teacher' ? 'teacher' : VIEW_TYPE;
      const IS_ALL_VIEW = VIEW_TYPE === 'all-student' || VIEW_TYPE === 'all-teacher';
      const scheduleDataElement = document.getElementById('schedule-data');
      let DATA = JSON.parse(scheduleDataElement ? scheduleDataElement.textContent || '{}' : '{}');
      if (scheduleDataElement) scheduleDataElement.remove();
      const startInput = document.getElementById('schedule-start-date');
      const endInput = document.getElementById('schedule-end-date');
      const periodSelect = document.getElementById('schedule-period-select');
      const summaryLabel = document.getElementById('schedule-summary-label');
      const toolbarElement = document.querySelector('.toolbar');
      const pagesElement = document.getElementById('schedule-pages');
      const personSearchInput = document.getElementById('schedule-person-search');
      const personSelect = document.getElementById('schedule-person-select');
      const applyButton = document.getElementById('schedule-apply-button');
      const scheduleSyncOverlay = document.getElementById('schedule-sync-overlay');
      // 盤面編集→別タブ反映の間の「同期中」スピナー。本体(盤面)が編集時に __showScheduleSyncing() を呼んで
      // 出し、同期ペイロード適用(flushIncomingPayload)で自動的に消す。来ないときの固着防止に保険タイマー。
      let scheduleSyncHideTimer = 0;
      // このポップアップ自身の操作(出席不可トグル等)はローカル反映＋fingerprint スキップ済みで、盤面からの
      // 同期エコーに実描画変化が無い。その間の「同期中」スピナーは連続入力の妨げになるだけなので抑制する。
      let suppressSyncSpinnerUntil = 0;
      function showScheduleSyncingOverlay() {
        if (!scheduleSyncOverlay) return;
        if (Date.now() < suppressSyncSpinnerUntil) return;
        if (scheduleSyncHideTimer) { window.clearTimeout(scheduleSyncHideTimer); scheduleSyncHideTimer = 0; }
        scheduleSyncOverlay.hidden = false;
        scheduleSyncHideTimer = window.setTimeout(hideScheduleSyncingOverlay, 8000);
      }
      function hideScheduleSyncingOverlay() {
        if (scheduleSyncHideTimer) { window.clearTimeout(scheduleSyncHideTimer); scheduleSyncHideTimer = 0; }
        if (scheduleSyncOverlay) scheduleSyncOverlay.hidden = true;
      }
      window.__showScheduleSyncing = showScheduleSyncingOverlay;
      const STORAGE_SCOPE = encodeURIComponent(String(DATA.classroomStorageKey || 'default'));
      const sharedStoragePrefix = 'schedule-shared:' + STORAGE_SCOPE + ':' + BASE_VIEW_TYPE + ':';
      const sharedGlobalStoragePrefix = 'schedule-shared:' + STORAGE_SCOPE + ':global:';
      const rangeStoragePrefix = sharedStoragePrefix + 'range:';
      const lessonTypeLabels = { extra: '増コマ', regular: '通常', makeup: '振替', special: '講習', trial: '体験' };
      const teacherTypeLabels = { normal: '', substitute: '代行', outside: '外部' };
      const dayLabels = ['日', '月', '火', '水', '木', '金', '土'];
      // 通常回数・講習回数表の表示順。算国は国の直後、理社は社の直後(いずれも小学限定の合体科目)、集理/集社は末尾。
      const subjectDefinitions = ['英', '数', '算', '国', '算国', '理', '生', '物', '化', '社', '理社'];
      const SUBJECT_SORT_ORDER = ['英', '数', '算', '国', '算国', '理', '生', '物', '化', '社', '理社', '集理', '集社'];
      let activeCountDialog = null;
      let activeTeacherRegisterDialog = null;
      let payloadFingerprint = buildPayloadFingerprint(DATA);
      let skipNextEquivalentPayload = false;
      let pendingIncomingPayload = null;
      let incomingPayloadJobId = 0;
      let suppressNextToggleClick = false;
      let appliedStartDate = '';
      let appliedEndDate = '';
      let appliedPeriodValue = '';
      let appliedPersonId = '';
      let personSelectionLocked = false;
      const pendingUnavailableKeys = new Set();
      const pendingUnavailableTimers = new Map();
      const interactionLockStorageKey = 'schedule-shared:interaction-lock';
      const interactionLockStaleMs = 5000;
      const interactionLockToken = VIEW_TYPE + '-' + Date.now() + '-' + Math.random().toString(36).slice(2, 10);
      let interactionLockOwner = null;
      let interactionLockSuspendUntil = 0;
      const interactionLockBanner = (() => {
        if (!(summaryLabel instanceof HTMLElement)) return null;
        const element = document.createElement('div');
        element.id = 'schedule-interaction-lock-banner';
        element.className = 'interaction-lock-banner';
        element.hidden = true;
        summaryLabel.insertAdjacentElement('afterend', element);
        return element;
      })();

      function escapeHtml(value) {
        return String(value || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\"/g, '&quot;');
      }

      function formatMonthDay(dateKey) {
        const parts = dateKey.split('-');
        return Number(parts[1]) + '月' + Number(parts[2]) + '日';
      }

      function formatRangeLabel(startDate, endDate) {
        if (!startDate || !endDate) return '';
        return formatMonthDay(startDate) + ' ～ ' + formatMonthDay(endDate);
      }

      function updateSheetScreenSize() {
        if (!(toolbarElement instanceof HTMLElement)) return;
        const toolbarRect = toolbarElement.getBoundingClientRect();
        document.documentElement.style.setProperty('--schedule-toolbar-offset', Math.max(toolbarRect.height, 0) + 'px');
      }

      function normalizeSchoolInfo(value) {
        return String(value || '').replace(/\u3000/g, ' ').replace(/\s+/g, ' ').trim();
      }

      function getSharedInputStorageKey(sharedKey) {
        if (sharedKey === 'school-info') return sharedGlobalStoragePrefix + sharedKey;
        return sharedStoragePrefix + sharedKey;
      }

      function getScheduleNoteId(noteKey) {
        return BASE_VIEW_TYPE + ':' + noteKey;
      }

      function getScheduleNoteValue(noteKey) {
        var notes = DATA.scheduleNotes || {};
        var value = notes[getScheduleNoteId(noteKey)];
        return typeof value === 'string' ? value : '';
      }

      function setScheduleNoteValue(noteKey, value) {
        if (!DATA.scheduleNotes) DATA.scheduleNotes = {};
        DATA.scheduleNotes[getScheduleNoteId(noteKey)] = String(value || '');
      }

      function buildPayloadFingerprint(payload) {
        var clone = { ...(payload || {}) };
        delete clone.scheduleNotes;
        clone.students = Array.isArray(clone.students) ? clone.students.map((student) => {
          var nextStudent = { ...student };
          delete nextStudent.qrSvg;
          return nextStudent;
        }) : [];
        clone.teachers = Array.isArray(clone.teachers) ? clone.teachers.map((teacher) => {
          var nextTeacher = { ...teacher };
          delete nextTeacher.qrSvg;
          return nextTeacher;
        }) : [];
        return JSON.stringify(clone);
      }

      function syncScheduleNoteInputs() {
        document.querySelectorAll('.memo-input').forEach((element) => {
          const noteKey = element.getAttribute('data-note-key');
          if (!noteKey || document.activeElement === element) return;
          const value = getScheduleNoteValue(noteKey);
          if (element.value !== value) element.value = value;
        });
      }

      function setDateInputValue(input, value) {
        input.value = value || '';
        if (value && !input.value) {
          const parsed = new Date(value + 'T00:00:00');
          if (!Number.isNaN(parsed.getTime())) {
            input.valueAsDate = parsed;
          }
        }
      }

      function getSharedStorage() {
        try {
          if (window.opener && window.opener !== window && window.opener.localStorage) {
            return window.opener.localStorage;
          }
        } catch {}
        try {
          return window.localStorage;
        } catch {
          return null;
        }
      }

      function getInteractionSurfaceLabel(surface) {
        if (surface === 'board') return 'コマ表';
        if (surface === 'teacher') return '講師日程表';
        return '生徒日程表';
      }

      function parseInteractionLock(rawValue) {
        if (!rawValue) return null;
        try {
          const parsed = JSON.parse(rawValue);
          if (!parsed || (parsed.owner !== 'board' && parsed.owner !== 'student' && parsed.owner !== 'teacher')) return null;
          const updatedAt = typeof parsed.updatedAt === 'number' ? parsed.updatedAt : Number(parsed.updatedAt);
          if (!Number.isFinite(updatedAt) || Date.now() - updatedAt > interactionLockStaleMs) return null;
          return {
            owner: parsed.owner,
            token: typeof parsed.token === 'string' ? parsed.token : '',
            updatedAt,
          };
        } catch {
          return null;
        }
      }

      function readInteractionLock() {
        const storage = getSharedStorage();
        if (!storage) return null;
        try {
          return parseInteractionLock(storage.getItem(interactionLockStorageKey));
        } catch {
          return null;
        }
      }

      function writeInteractionLock(payload) {
        const storage = getSharedStorage();
        if (!storage) return;
        try {
          if (!payload) {
            storage.removeItem(interactionLockStorageKey);
            return;
          }
          storage.setItem(interactionLockStorageKey, JSON.stringify(payload));
        } catch {}
      }

      function refreshInteractionLockState() {
        const currentLock = readInteractionLock();
        interactionLockOwner = currentLock ? currentLock.owner : null;
        const isLocked = Boolean(interactionLockOwner && interactionLockOwner !== VIEW_TYPE);
        document.body.classList.toggle('surface-locked', isLocked);
        if (interactionLockBanner) {
          interactionLockBanner.hidden = !isLocked;
          if (isLocked) {
            interactionLockBanner.textContent = getInteractionSurfaceLabel(interactionLockOwner) + ' を操作中です。この画面をクリックすると操作を切り替えます。';
          }
        }
      }

      function acquireInteractionLock() {
        if (Date.now() < interactionLockSuspendUntil) {
          refreshInteractionLockState();
          return;
        }
        writeInteractionLock({ owner: VIEW_TYPE, token: interactionLockToken, updatedAt: Date.now() });
        interactionLockOwner = VIEW_TYPE;
        refreshInteractionLockState();
      }

      function releaseInteractionLock() {
        const currentLock = readInteractionLock();
        if (currentLock && currentLock.token === interactionLockToken) {
          writeInteractionLock(null);
        }
        refreshInteractionLockState();
      }

      function resolveSharedInputValue(sharedKey) {
        const activeElement = document.querySelector('.shared-input[data-shared-input="' + sharedKey + '"]');
        if (activeElement && 'value' in activeElement && typeof activeElement.value === 'string' && activeElement.value) {
          return activeElement.value;
        }

        const storage = getSharedStorage();
        try {
          return storage ? storage.getItem(getSharedInputStorageKey(sharedKey)) || '' : '';
        } catch {
          return '';
        }
      }

      function shouldShowScheduleQr() {
        return true;
      }

      function syncScheduleQrVisibility() {
        // QR visibility is now based on submission status per person, handled at render time
      }

      function resolveScheduleQrSvg(person) {
        if (!person) return '';
        if (typeof person.qrSvg === 'string' && person.qrSvg) return person.qrSvg;
        const submissionToken = typeof person.submissionToken === 'string' ? person.submissionToken : '';
        if (!submissionToken) return '';
        let qrSvg = '';
        try {
          if (window.opener && window.opener !== window && typeof window.opener.__buildScheduleQrSvg === 'function') {
            qrSvg = window.opener.__buildScheduleQrSvg(submissionToken) || '';
          }
        } catch {}
        if (!qrSvg) {
          try {
            if (typeof window.__buildScheduleQrSvg === 'function') {
              qrSvg = window.__buildScheduleQrSvg(submissionToken) || '';
            }
          } catch {}
        }
        if (qrSvg) person.qrSvg = qrSvg;
        return qrSvg;
      }

      function buildScheduleQrHtml(person, showQr) {
        if (!showQr || !person) return '';
        const submittedBadgeHtml = person.submissionSubmitted ? '<span class="submission-badge print-only-hidden">希望<br>提出済</span>' : '';
        if (person.submissionSubmitted && !DATA.showSubmittedQr) {
          return submittedBadgeHtml;
        }
        const qrSvg = resolveScheduleQrSvg(person);
        const qrHtml = qrSvg ? '<span class="qr-code">' + qrSvg + '</span>' : '';
        return qrHtml + submittedBadgeHtml;
      }

      function mergeCachedQrSvg(nextPayload) {
        if (!nextPayload || !DATA) return;
        const currentStudentQrById = new Map((DATA.students || []).map((student) => [student.id, student.qrSvg || '']));
        const currentTeacherQrById = new Map((DATA.teachers || []).map((teacher) => [teacher.id, teacher.qrSvg || '']));
        (nextPayload.students || []).forEach((student) => {
          if (!student.qrSvg) {
            const cached = currentStudentQrById.get(student.id);
            if (cached) student.qrSvg = cached;
          }
        });
        (nextPayload.teachers || []).forEach((teacher) => {
          if (!teacher.qrSvg) {
            const cached = currentTeacherQrById.get(teacher.id);
            if (cached) teacher.qrSvg = cached;
          }
        });
      }

      function isVisibleInRange(item, startDate, endDate) {
        var today = new Date().toISOString().slice(0, 10);
        if (item.withdrawDate && item.withdrawDate !== '未定' && item.withdrawDate < today) return false;
        return item.entryDate <= endDate && (!item.withdrawDate || item.withdrawDate === '未定' || item.withdrawDate >= startDate);
      }

      function getGradeLabel(birthDate, referenceDate) {
        if (!birthDate) return '';
        const birthParts = birthDate.split('-').map(Number);
        const ref = new Date(referenceDate + 'T00:00:00');
        const schoolYear = ref >= new Date(ref.getFullYear(), 3, 1) ? ref.getFullYear() : ref.getFullYear() - 1;
        const enrollmentYear = birthParts[1] < 4 || (birthParts[1] === 4 && birthParts[2] === 1) ? birthParts[0] + 6 : birthParts[0] + 7;
        const gradeNumber = schoolYear - enrollmentYear + 1;
        if (gradeNumber <= 1) return '小1';
        if (gradeNumber === 2) return '小2';
        if (gradeNumber === 3) return '小3';
        if (gradeNumber === 4) return '小4';
        if (gradeNumber === 5) return '小5';
        if (gradeNumber === 6) return '小6';
        if (gradeNumber === 7) return '中1';
        if (gradeNumber === 8) return '中2';
        if (gradeNumber === 9) return '中3';
        if (gradeNumber === 10) return '高1';
        if (gradeNumber === 11) return '高2';
        return '高3';
      }
      function filterCells(startDate, endDate) {
        return DATA.cells.filter((cell) => cell.dateKey >= startDate && cell.dateKey <= endDate);
      }

      function sortSlotKeys(slotKeys) {
        return Array.from(new Set((slotKeys || []).filter((slotKey) => typeof slotKey === 'string' && slotKey))).sort((left, right) => left.localeCompare(right, 'ja', { numeric: true }));
      }

      function normalizeSubjectSlots(subjectSlots) {
        const next = {};
        subjectDefinitions.forEach((subject) => {
          const rawValue = Number(subjectSlots && typeof subjectSlots === 'object' ? subjectSlots[subject] : 0);
          const normalizedValue = Number.isFinite(rawValue) ? Math.max(0, Math.trunc(rawValue)) : 0;
          if (normalizedValue > 0) next[subject] = normalizedValue;
        });
        return next;
      }

      function defaultStudentSessionInput() {
        return { unavailableSlots: [], subjectSlots: {}, subjectDurations: {}, regularOnly: false, countSubmitted: false };
      }

      // 科目ごとの授業時間(分)。QR提出と同じく 60/45 のみ保持し、90(既定)や不正値は落とす。
      // spec-lecture-stock §6 / resolveLectureSubjectDuration と整合。
      function normalizeSubjectDurations(map) {
        var next = {};
        if (!map || typeof map !== 'object') return next;
        Object.keys(map).forEach(function(subject) {
          var v = Number(map[subject]);
          if (v === 60 || v === 45) next[subject] = v;
        });
        return next;
      }

      function defaultTeacherSessionInput() {
        return { unavailableSlots: [], countSubmitted: false };
      }

      function getSpecialSessionById(sessionId) {
        return (DATA.specialSessions || []).find((session) => session.id === sessionId) || null;
      }

      function getStudentSessionInput(studentId, sessionId) {
        const session = getSpecialSessionById(sessionId);
        const current = session && session.studentInputs ? session.studentInputs[studentId] : null;
        return {
          ...defaultStudentSessionInput(),
          ...(current || {}),
          unavailableSlots: sortSlotKeys(current && Array.isArray(current.unavailableSlots) ? current.unavailableSlots : []),
          subjectSlots: normalizeSubjectSlots(current && current.subjectSlots ? current.subjectSlots : {}),
          subjectDurations: normalizeSubjectDurations(current && current.subjectDurations ? current.subjectDurations : {}),
          regularOnly: Boolean(current && current.regularOnly),
          countSubmitted: Boolean(current && current.countSubmitted),
        };
      }

      function getTeacherSessionInput(teacherId, sessionId) {
        const session = getSpecialSessionById(sessionId);
        const current = session && session.teacherInputs ? session.teacherInputs[teacherId] : null;
        return {
          ...defaultTeacherSessionInput(),
          ...(current || {}),
          unavailableSlots: sortSlotKeys(current && Array.isArray(current.unavailableSlots) ? current.unavailableSlots : []),
          countSubmitted: Boolean(current && current.countSubmitted),
        };
      }

      function isStudentSessionUnavailableFixed(studentId, sessionId) {
        return Boolean(studentId && sessionId && getStudentSessionInput(studentId, sessionId).countSubmitted);
      }

      function isTeacherSessionUnavailableFixed(teacherId, sessionId) {
        return Boolean(teacherId && sessionId && getTeacherSessionInput(teacherId, sessionId).countSubmitted);
      }

      function getEditableSpecialSessionsForStudent(studentId, dateKey) {
        return getSpecialSessionsForDate(dateKey).filter((session) => !isStudentSessionUnavailableFixed(studentId, session.id));
      }

      function getEditableSpecialSessionsForTeacher(teacherId, dateKey) {
        return getSpecialSessionsForDate(dateKey).filter((session) => !isTeacherSessionUnavailableFixed(teacherId, session.id));
      }

      function syncPayloadFingerprint() {
        payloadFingerprint = buildPayloadFingerprint(DATA);
        skipNextEquivalentPayload = true;
      }

      function toDateKey(date) {
        const year = date.getFullYear();
        const month = String(date.getMonth() + 1).padStart(2, '0');
        const day = String(date.getDate()).padStart(2, '0');
        return year + '-' + month + '-' + day;
      }

      function isOpenDayByRules(dateKey, fallbackOpenState) {
        if (typeof fallbackOpenState === 'boolean') return fallbackOpenState;
        if (DATA.availability.forceOpenDates.includes(dateKey)) return true;
        if (DATA.availability.holidayDates.includes(dateKey)) return false;
        return !DATA.availability.closedWeekdays.includes(new Date(dateKey + 'T00:00:00').getDay());
      }

      function buildDateHeaders(startDate, endDate) {
        const byDate = new Map(DATA.cells.map((cell) => [cell.dateKey, cell]));
        const headers = [];
        const start = new Date(startDate + 'T00:00:00');
        const end = new Date(endDate + 'T00:00:00');
        for (let cursor = new Date(start); cursor <= end; cursor.setDate(cursor.getDate() + 1)) {
          const dateKey = toDateKey(cursor);
          const known = byDate.get(dateKey);
          headers.push({
            dateKey,
            dateLabel: Number(dateKey.split('-')[1]) + '/' + Number(dateKey.split('-')[2]),
            isOpenDay: isOpenDayByRules(dateKey, known ? known.isOpenDay : undefined),
            weekday: cursor.getDay(),
          });
        }
        return headers;
      }

      function buildMonthGroups(dateHeaders) {
        const groups = [];
        dateHeaders.forEach((header) => {
          const month = Number(header.dateKey.split('-')[1]);
          const last = groups[groups.length - 1];
          if (last && last.month === month) {
            last.count += 1;
          } else {
            groups.push({ month, count: 1 });
          }
        });
        return groups;
      }

      function getVisibleYears(dateHeaders) {
        return Array.from(new Set(dateHeaders.map((header) => Number(header.dateKey.split('-')[0]))));
      }

      function getSlotNumbers() {
        return Array.from(new Set(DATA.cells.map((cell) => cell.slotNumber))).sort((left, right) => left - right);
      }

      function splitTimeLabel(timeLabel) {
        const normalized = String(timeLabel || '').replace(/\s+/g, '');
        const matched = normalized.match(/^(.+?)[-~〜](.+)$/);
        if (!matched) return { start: normalized, end: '' };
        return { start: matched[1], end: matched[2] };
      }

      function renderTimeHeaderCell(timeLabel, slotNumber, actionHtml) {
        // spec-group-lesson レイアウト調整: 縦幅確保のため「～」と「N限」を省き、開始/終了時間だけを表示する。
        const range = splitTimeLabel(timeLabel);
        const rangeHtml = range.end
          ? '<div class="time-range"><span class="time-part">' + escapeHtml(range.start) + '</span><span class="time-part">' + escapeHtml(range.end) + '</span></div>'
          : '<div class="time-range"><span class="time-part">' + escapeHtml(range.start) + '</span></div>';
        const contentHtml = '<div class="time-box">' + rangeHtml + '</div>';
        return '<th class="time-col">' + (actionHtml ? actionHtml.replace('__CONTENT__', contentHtml) : contentHtml) + '</th>';
      }

      function buildPeriodSegments(dateHeaders) {
        const segments = [];
        let cursor = 0;
        while (cursor < dateHeaders.length) {
          const header = dateHeaders[cursor];
          const matched = DATA.periodBands.find((band) => header.dateKey >= band.startDate && header.dateKey <= band.endDate);
          if (!matched) {
            const gapStart = cursor;
            while (cursor < dateHeaders.length && !DATA.periodBands.find((band) => dateHeaders[cursor].dateKey >= band.startDate && dateHeaders[cursor].dateKey <= band.endDate)) {
              cursor += 1;
            }
            segments.push({ type: 'gap', key: 'gap-' + gapStart, colSpan: cursor - gapStart });
            continue;
          }
          const segmentStart = cursor;
          while (cursor < dateHeaders.length && dateHeaders[cursor].dateKey >= matched.startDate && dateHeaders[cursor].dateKey <= matched.endDate) {
            cursor += 1;
          }
          segments.push({ type: 'band', key: matched.label + '-' + segmentStart, colSpan: cursor - segmentStart, label: matched.label, startDate: matched.startDate, endDate: matched.endDate, sessionId: matched.id || '' });
        }
        return segments;
      }

      function getTableDensityClass(dateHeaders) {
        if (dateHeaders.length >= 38) return 'is-dense is-ultra-dense';
        if (dateHeaders.length >= 28) return 'is-dense';
        if (dateHeaders.length >= 18) return 'is-compact';
        return '';
      }

      function buildCellMap(cells) {
        const map = new Map();
        cells.forEach((cell) => {
          map.set(cell.dateKey + '_' + cell.slotNumber, cell);
        });
        return map;
      }

      function normalizeStudentAssignmentName(value) {
        return String(value || '').replace(/\s+/g, '').trim();
      }

      function getNameAssignmentKey(value) {
        var normalized = normalizeStudentAssignmentName(value);
        return normalized ? 'name:' + normalized : '';
      }

      function buildUniqueStudentNameOwnerMap() {
        var ownerByName = new Map();
        (DATA.students || []).forEach(function(student) {
          [student.name, student.fullName].forEach(function(name) {
            var key = getNameAssignmentKey(name);
            if (!key) return;
            var current = ownerByName.get(key);
            if (current && current !== student.id) ownerByName.set(key, '');
            else if (current !== '') ownerByName.set(key, student.id);
          });
        });
        return ownerByName;
      }

      function getStudentAssignmentKeys(student) {
        var keys = [student.id];
        var ownerByName = buildUniqueStudentNameOwnerMap();
        [student.name, student.fullName].forEach(function(name) {
          var key = getNameAssignmentKey(name);
          if (key && ownerByName.get(key) === student.id && !keys.includes(key)) keys.push(key);
        });
        return keys;
      }

      function buildStudentAssignments(cells) {
        const map = new Map();
        cells.forEach((cell) => {
          cell.desks.forEach((desk) => {
            if (desk.lesson) {
              desk.lesson.students.forEach((student) => {
                // 体験授業生徒は既存生徒として扱わない (同名でも生徒日程表へ載せない)
                if (student.lessonType === 'trial') return;
                const studentKey = student.linkedStudentId || getNameAssignmentKey(student.name);
                if (!studentKey) return;
                if (!map.has(studentKey)) map.set(studentKey, []);
                map.get(studentKey).push({ dateKey: cell.dateKey, slotNumber: cell.slotNumber, teacher: desk.teacher, timeLabel: cell.timeLabel, lesson: student });
              });
            }
            (Array.isArray(desk.statuses) ? desk.statuses : []).forEach((statusEntry) => {
              if (!statusEntry) return;
              if (statusEntry.lessonType === 'trial') return;
              if (statusEntry.status === 'moved') return;
              const studentKey = statusEntry.linkedStudentId || getNameAssignmentKey(statusEntry.name);
              if (!studentKey) return;
              if (!map.has(studentKey)) map.set(studentKey, []);
              map.get(studentKey).push({ dateKey: cell.dateKey, slotNumber: cell.slotNumber, teacher: statusEntry.teacherName || desk.teacher, timeLabel: cell.timeLabel, lesson: statusEntry });
            });
          });
        });
        return map;
      }

      function normalizeTeacherAssignmentName(value) {
        return Array.from(String(value || '')).filter(function(char) { return char.trim(); }).join('');
      }

      function buildTeacherAssignments(cells) {
        const map = new Map();
        cells.forEach((cell) => {
          cell.desks.forEach((desk) => {
            const statuses = (Array.isArray(desk.statuses) ? desk.statuses : []).filter(Boolean);
            if (!desk.teacher || (!desk.lesson && statuses.length === 0)) return;
            const entry = { dateKey: cell.dateKey, slotNumber: cell.slotNumber, timeLabel: cell.timeLabel, students: desk.lesson ? desk.lesson.students : [], statuses, note: desk.lesson ? desk.lesson.note || '' : '' };
            const teacherKeys = [];
            if (desk.teacherId) teacherKeys.push(desk.teacherId);
            else if (Array.isArray(desk.regularTeacherIds)) teacherKeys.push.apply(teacherKeys, desk.regularTeacherIds.filter(Boolean));
            [desk.teacher, normalizeTeacherAssignmentName(desk.teacher)].filter(Boolean).forEach((teacherKey) => {
              teacherKeys.push(teacherKey);
            });
            Array.from(new Set(teacherKeys)).forEach((teacherKey) => {
              if (!map.has(teacherKey)) map.set(teacherKey, []);
              map.get(teacherKey).push(entry);
            });
          });
        });
        return map;
      }

      function collectTeacherAssignmentEntries(assignmentMap, teacher) {
        const keys = [teacher.id, teacher.name, teacher.fullName, normalizeTeacherAssignmentName(teacher.name), normalizeTeacherAssignmentName(teacher.fullName)].filter(Boolean);
        const entries = [];
        const seen = new Set();
        keys.forEach((key) => {
          (assignmentMap.get(key) || []).forEach((entry) => {
            const studentKey = (entry.students || []).map((student) => student.id || student.name).join(',');
            const statusKey = (entry.statuses || []).map((status) => status.id || status.name).join(',');
            const dedupeKey = [entry.dateKey, entry.slotNumber, studentKey, statusKey, entry.note || ''].join('__');
            if (seen.has(dedupeKey)) return;
            seen.add(dedupeKey);
            entries.push(entry);
          });
        });
        return entries;
      }

      function findFirstVisibleStudentWithSchedule(startDate, endDate, students) {
        const visibleStudents = Array.isArray(students) ? students : [];
        if (!visibleStudents.length) return '';
        const visibleStudentById = new Map(visibleStudents.map((student) => [student.id, student]));
        const ownerByName = buildUniqueStudentNameOwnerMap();
        const filteredCells = filterCells(startDate, endDate);

        for (const cell of filteredCells) {
          for (const desk of cell.desks || []) {
            const lessonStudents = desk.lesson && Array.isArray(desk.lesson.students) ? desk.lesson.students : [];
            for (const lessonStudent of lessonStudents) {
              if (!lessonStudent || lessonStudent.lessonType === 'trial') continue;
              if (lessonStudent.linkedStudentId && visibleStudentById.has(lessonStudent.linkedStudentId)) return lessonStudent.linkedStudentId;
              const ownerId = ownerByName.get(getNameAssignmentKey(lessonStudent.name));
              if (ownerId && visibleStudentById.has(ownerId)) return ownerId;
            }

            const statuses = Array.isArray(desk.statuses) ? desk.statuses : [];
            for (const statusEntry of statuses) {
              if (!statusEntry || statusEntry.lessonType === 'trial' || statusEntry.status === 'moved') continue;
              if (statusEntry.linkedStudentId && visibleStudentById.has(statusEntry.linkedStudentId)) return statusEntry.linkedStudentId;
              const ownerId = ownerByName.get(getNameAssignmentKey(statusEntry.name));
              if (ownerId && visibleStudentById.has(ownerId)) return ownerId;
            }
          }
        }

        return '';
      }

      function findFirstVisibleTeacherWithSchedule(startDate, endDate, teachers) {
        const visibleTeachers = Array.isArray(teachers) ? teachers : [];
        if (!visibleTeachers.length) return '';
        const filteredCells = filterCells(startDate, endDate);

        for (const cell of filteredCells) {
          for (const desk of cell.desks || []) {
            const teacherName = typeof desk.teacher === 'string' ? desk.teacher.trim() : '';
            if (!teacherName) continue;
            const teacherId = typeof desk.teacherId === 'string' ? desk.teacherId.trim() : '';
            const teacherNameKey = normalizeTeacherAssignmentName(teacherName);
            const matchedTeacher = teacherId
              ? visibleTeachers.find((teacher) => teacher.id === teacherId)
              : visibleTeachers.find((teacher) => teacher.name === teacherName || teacher.fullName === teacherName || normalizeTeacherAssignmentName(teacher.name) === teacherNameKey || normalizeTeacherAssignmentName(teacher.fullName) === teacherNameKey);
            if (!matchedTeacher) continue;
            const hasLesson = Boolean(desk.lesson && Array.isArray(desk.lesson.students) && desk.lesson.students.some((student) => student && student.lessonType !== 'trial'));
            const hasStatus = Array.isArray(desk.statuses) && desk.statuses.some((statusEntry) => statusEntry && statusEntry.lessonType !== 'trial' && statusEntry.status !== 'moved');
            if (hasLesson || hasStatus) return matchedTeacher.id;
          }
        }

        return '';
      }

      function toCountRows(countMap, desiredCountMap, forcedLabels, options) {
        var hideZeroZero = options && options.hideZeroZero;
        const mergedLabels = Array.from(new Set([
          ...(forcedLabels || []),
          ...Object.keys(countMap || {}),
          ...Object.keys(desiredCountMap || {}),
        ])).sort((left, right) => {
          const li = SUBJECT_SORT_ORDER.indexOf(left);
          const ri = SUBJECT_SORT_ORDER.indexOf(right);
          if (li !== -1 && ri !== -1) return li - ri;
          if (li !== -1) return -1;
          if (ri !== -1) return 1;
          return left.localeCompare(right, 'ja');
        });
        if (!mergedLabels.length) return '<tr><td>予定なし</td><td>0</td></tr>';
        const labelMinutesMap = (options && options.labelMinutesMap) || null;
        const rows = mergedLabels.flatMap((label) => {
          const count = Number(countMap && countMap[label] ? countMap[label] : 0);
          const desiredCount = Number(desiredCountMap && desiredCountMap[label] ? desiredCountMap[label] : count);
          if (hideZeroZero && count === 0 && desiredCount === 0) return [];
          // 科目の横に授業時間(60/45分)を併記する。90分(既定)や不明・混在は付けない。spec-schedule-pdf §D。
          const minutesSuffix = labelMinutesMap && labelMinutesMap[label] ? labelMinutesMap[label] : '';
          const displayLabel = label + (minutesSuffix ? minutesSuffix + '分' : '');
          return ['<tr><td>' + escapeHtml(displayLabel) + '</td><td>' + count + '<span class="print-only-hidden">(' + desiredCount + ')</span></td></tr>'];
        });
        return rows.length > 0 ? rows.join('') : '<tr><td>予定なし</td><td>0</td></tr>';
      }

      function hasCountMismatch(countMap, desiredCountMap) {
        const mergedLabels = Array.from(new Set([
          ...Object.keys(countMap || {}),
          ...Object.keys(desiredCountMap || {}),
        ]));
        return mergedLabels.some((label) => {
          const count = Number(countMap && countMap[label] ? countMap[label] : 0);
          const desiredCount = Number(desiredCountMap && desiredCountMap[label] ? desiredCountMap[label] : count);
          return count !== desiredCount;
        });
      }

      function getPreferredMathSubject(student, referenceDate) {
        const gradeLabel = getGradeLabel(student && student.birthDate, referenceDate);
        return gradeLabel.startsWith('小') ? '算' : '数';
      }

      function getVisibleSubjectsForStudent(student, referenceDate, additionalSubjects) {
        const preferredMathSubject = getPreferredMathSubject(student, referenceDate);
        const gradeLabel = getGradeLabel(student && student.birthDate, referenceDate);
        const prefersHighSchoolScience = gradeLabel.startsWith('高');
        const legacySubjects = Array.isArray(additionalSubjects) ? additionalSubjects : [];
        return subjectDefinitions.filter((subject) => {
          if (subject === '算' || subject === '数') return subject === preferredMathSubject;
          if (subject === '算国') return preferredMathSubject === '算';
          // 理社は算国と同じく小学限定の合体科目。小学(preferredMathSubject==='算')のみ表示。
          if (subject === '理社') return preferredMathSubject === '算';
          // 理は学年を問わず常に表示。高校生は理に加えて生・物・化も表示する。
          if (subject === '理') return true;
          if (subject === '生' || subject === '物' || subject === '化') return prefersHighSchoolScience || legacySubjects.includes(subject);
          return true;
        });
      }

      function normalizeSubjectForStudent(subject, student, referenceDate) {
        if (subject === '算国') return getPreferredMathSubject(student, referenceDate) === '算' ? '算国' : '数';
        if (subject === '理社') return getPreferredMathSubject(student, referenceDate) === '算' ? '理社' : '理';
        if (subject !== '算' && subject !== '数') return subject;
        return getPreferredMathSubject(student, referenceDate);
      }

      function normalizeCountMapSubjects(countMap, student, referenceDate) {
        const next = {};
        Object.entries(countMap || {}).forEach(([subject, value]) => {
          const normalizedSubject = normalizeSubjectForStudent(subject, student, referenceDate);
          const normalizedValue = Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;
          if (normalizedValue <= 0) return;
          next[normalizedSubject] = (next[normalizedSubject] || 0) + normalizedValue;
        });
        return next;
      }

      function filterCountMapToSubjects(countMap, visibleSubjects) {
        return Object.fromEntries(Object.entries(countMap || {}).filter(([label]) => visibleSubjects.includes(label)));
      }

      // 講習回数表の科目に併記する授業時間サフィックスを決める。渡された分数(60/45のみ)が
      // 一意なら返し、混在・空・90分だけのときは '' を返す(誤解を招く併記をしない)。spec-schedule-pdf §D。
      function pickLectureMinutesSuffix(suffixes) {
        var unique = Array.from(new Set((suffixes || []).filter(function(s) { return s === '60' || s === '45'; })));
        return unique.length === 1 ? unique[0] : '';
      }

      // 講習回数表に併記する科目→分数を決める。実配置コマの分数(placedListBySubject)を優先し、
      // 未配置(希望登録のみ)の科目は希望登録の分数(desiredMinutesBySubject)でフォールバックする。
      function resolveLectureMinutesBySubject(placedListBySubject, desiredMinutesBySubject) {
        var placed = placedListBySubject || {};
        var desired = desiredMinutesBySubject || {};
        var map = {};
        Array.from(new Set(Object.keys(placed).concat(Object.keys(desired)))).forEach(function(subject) {
          var placedSuffix = pickLectureMinutesSuffix(placed[subject] || []);
          if (placedSuffix) map[subject] = placedSuffix;
          else if (desired[subject]) map[subject] = desired[subject];
        });
        return map;
      }

      // 授業時間(分)サフィックス。60/45 のみ付与し、90(既定)は付けない。spec-schedule-pdf §D。
      function formatScheduleMinutesSuffix(noteSuffix) {
        var v = String(noteSuffix == null ? '' : noteSuffix).trim();
        return (v === '60' || v === '45') ? v : '';
      }

      // 日程表コマ組み(別タブD&D): 掴める授業カードか判定し、掴めるなら drag 用の属性を返す。
      // 対象は通常/振替/講習/増コマ(集団は別行・体験や出欠済みの記録カードは対象外)。scheduleDndEnabled 時だけ有効。
      function buildLessonCardDragAttrs(entry) {
        if (!DATA.scheduleDndEnabled) return '';
        var type = entry.lessonType;
        if (type !== 'regular' && type !== 'makeup' && type !== 'special' && type !== 'extra') return '';
        if (!entry.id) return '';
        return ' class="lesson-card is-draggable" data-role="lesson-card-draggable"'
          + ' data-entry-id="' + escapeHtml(entry.id) + '"'
          + ' data-linked-student-id="' + escapeHtml(entry.linkedStudentId || '') + '"'
          + ' data-lesson-type="' + escapeHtml(type) + '"'
          + ' data-subject="' + escapeHtml(entry.subject || '') + '"'
          + ' data-student-name="' + escapeHtml(entry.name || '') + '"';
      }

      function renderStudentCellCard(entry) {
        var subjectWithMinutes = entry.subject + formatScheduleMinutesSuffix(entry.noteSuffix);
        if (entry.status === 'absent' || entry.status === 'absent-no-makeup' || entry.status === 'attended') {
          var statusLabel = entry.status === 'attended' ? '出席' : entry.status === 'absent-no-makeup' ? '振無休' : '休';
          var linkedDestinationLabel = entry.linkedDestinationDateKey ? formatMonthDay(entry.linkedDestinationDateKey) : '';
          return '<div class="lesson-card"><div class="lesson-main">' + escapeHtml([statusLabel, linkedDestinationLabel].filter(Boolean).join(' ')) + '</div><div class="lesson-sub">' + escapeHtml([subjectWithMinutes, lessonTypeLabels[entry.lessonType] || entry.lessonType].filter(Boolean).join(' / ')) + '</div></div>';
        }
        var dragAttrs = buildLessonCardDragAttrs(entry);
        var openTag = dragAttrs ? '<div' + dragAttrs + '>' : '<div class="lesson-card">';
        return openTag + '<div class="lesson-main">' + escapeHtml(subjectWithMinutes) + '</div><div class="lesson-sub">' + escapeHtml(lessonTypeLabels[entry.lessonType] || entry.lessonType) + '</div></div>';
      }

      function renderStudentCellCards(entries) {
        const lessons = (entries || []).map((entry) => entry.lesson).filter(Boolean);
        if (lessons.length === 0) return '<div class="empty-label"></div>';
        if (lessons.length === 1) return renderStudentCellCard(lessons[0]);
        return '<div class="lesson-card-stack">' + lessons.map((lesson) => '<div class="lesson-card-stack-item">' + renderStudentCellCard(lesson) + '</div>').join('') + '</div>';
      }

      // ==== 日程表コマ組み(別タブD&D・spec-student-schedule-dnd) ==================================
      // 生徒日程表の授業カードを長押し(約250ms)→空きコマへドラッグ→机選択モーダル→席確定で、本体盤面へ
      // schedule-student-move-request を送る。移動の実処理は盤面(executeScheduleViewMove)。ここは UI と要求送信のみ。
      // 自動同期の再描画(flushIncomingPayload)は pagesElement.innerHTML を差し替えるため、pointerdown は
      // 再描画で消えない安定要素(pagesElement)への委譲で拾う。ドラッグ中/モーダル表示中に再描画が来たら破棄する。
      var scheduleDndDrag = null; // { phase:'pending'|'dragging', pointerId, startX, startY, card, source, ghost, hoverCell }
      var scheduleDndLongPressTimer = null;
      var scheduleDeskPickerOverlay = null;
      var scheduleDeskPickerKeydown = null;
      var scheduleMoveErrorOverlay = null;   // 移動失敗の理由オーバーレイ
      var scheduleMoveHighlightKey = null;   // 移動成立コマ(dateKey_slotNumber)を数秒ハイライト
      var scheduleMoveHighlightTimer = null;
      // 移動成立の通知はスピナー表示中に届くことがあるため、同期スピナーが消えるまでハイライト開始を
      // 保留する(スピナーと4秒ハイライトの窓が被って見えづらくなるのを避ける)。
      var pendingScheduleMoveHighlightKey = null;

      function findScheduleCellForMove(dateKey, slotNumber) {
        var cells = Array.isArray(DATA.cells) ? DATA.cells : [];
        for (var i = 0; i < cells.length; i++) {
          if (cells[i].dateKey === dateKey && cells[i].slotNumber === slotNumber) return cells[i];
        }
        return null;
      }

      // ポインタ座標の下にあるドロップ可能な空きコマ(td)を返す。開校日・当該生徒が空き(カード無し)・
      // pickerDesks を持つコマだけが対象。掴んでいる元カードのコマ自身は空きではないので自然に除外される。
      function findDroppableCellFromPoint(clientX, clientY) {
        var element = document.elementFromPoint(clientX, clientY);
        if (!element || !(element instanceof HTMLElement)) return null;
        var cell = element.closest('td[data-role="student-slot-cell"]');
        if (!cell || !(cell instanceof HTMLElement)) return null;
        if (cell.classList.contains('is-holiday')) return null;
        if (cell.querySelector('.lesson-card')) return null; // 当該生徒が既にそのコマに授業を持つ
        var dateKey = cell.getAttribute('data-date-key');
        var slotNumber = Number(cell.getAttribute('data-slot-number'));
        var payloadCell = findScheduleCellForMove(dateKey, slotNumber);
        if (!payloadCell || !Array.isArray(payloadCell.pickerDesks) || payloadCell.pickerDesks.length === 0) return null;
        return cell;
      }

      function clearScheduleDropHighlight() {
        var previous = document.querySelector('.slot-cell.is-drop-target');
        if (previous) previous.classList.remove('is-drop-target');
      }

      function removeScheduleDragGhost() {
        if (scheduleDndDrag && scheduleDndDrag.ghost && scheduleDndDrag.ghost.parentNode) {
          scheduleDndDrag.ghost.parentNode.removeChild(scheduleDndDrag.ghost);
        }
      }

      // ドラッグ/長押し待ちの後始末(モーダルは閉じない)。
      function endScheduleDndDrag() {
        if (scheduleDndLongPressTimer) { window.clearTimeout(scheduleDndLongPressTimer); scheduleDndLongPressTimer = null; }
        clearScheduleDropHighlight();
        removeScheduleDragGhost();
        if (scheduleDndDrag && scheduleDndDrag.card) scheduleDndDrag.card.classList.remove('is-drag-origin');
        document.removeEventListener('pointermove', onScheduleDndPointerMove, true);
        document.removeEventListener('pointerup', onScheduleDndPointerUp, true);
        document.removeEventListener('pointercancel', onScheduleDndPointerCancel, true);
        scheduleDndDrag = null;
      }

      // ドラッグ中も机選択モーダルも含めて破棄(再描画時に呼ぶ)。
      function cancelScheduleDndInteraction() {
        endScheduleDndDrag();
        closeScheduleDeskPicker();
      }

      function startScheduleDndDrag(clientX, clientY) {
        if (!scheduleDndDrag) return;
        scheduleDndDrag.phase = 'dragging';
        scheduleDndDrag.card.classList.add('is-drag-origin');
        var ghost = document.createElement('div');
        ghost.className = 'schedule-drag-ghost';
        ghost.textContent = (scheduleDndDrag.source.subject || '') + ' ' + (lessonTypeLabels[scheduleDndDrag.source.lessonType] || '');
        document.body.appendChild(ghost);
        scheduleDndDrag.ghost = ghost;
        moveScheduleDragGhost(clientX, clientY);
      }

      function moveScheduleDragGhost(clientX, clientY) {
        if (scheduleDndDrag && scheduleDndDrag.ghost) {
          scheduleDndDrag.ghost.style.left = clientX + 'px';
          scheduleDndDrag.ghost.style.top = clientY + 'px';
        }
      }

      function onScheduleDndPointerMove(event) {
        if (!scheduleDndDrag || event.pointerId !== scheduleDndDrag.pointerId) return;
        var dx = event.clientX - scheduleDndDrag.startX;
        var dy = event.clientY - scheduleDndDrag.startY;
        if (scheduleDndDrag.phase === 'pending') {
          // 長押し完了前に動きすぎたら「スクロール/誤タップ」としてドラッグにしない。
          if (Math.abs(dx) > 10 || Math.abs(dy) > 10) { endScheduleDndDrag(); }
          return;
        }
        event.preventDefault();
        moveScheduleDragGhost(event.clientX, event.clientY);
        var cell = findDroppableCellFromPoint(event.clientX, event.clientY);
        var current = document.querySelector('.slot-cell.is-drop-target');
        if (current && current !== cell) current.classList.remove('is-drop-target');
        if (cell && cell !== current) cell.classList.add('is-drop-target');
      }

      function onScheduleDndPointerUp(event) {
        if (!scheduleDndDrag || event.pointerId !== scheduleDndDrag.pointerId) return;
        if (scheduleDndDrag.phase !== 'dragging') {
          // 長押し未満のタップ = ドラッグではない。掴めるカードでも既存の「出席不可トグル」を維持する。
          // (pointerdown で stopImmediatePropagation してトグルを止めているので、ここでタップとして実行する。)
          var tapCard = scheduleDndDrag.card;
          endScheduleDndDrag();
          if (tapCard && typeof handleUnavailablePointerDown === 'function') {
            var tapCell = tapCard.closest('td[data-role="student-slot-cell"]');
            if (tapCell && tapCell.getAttribute('data-editable') === 'true') {
              handleUnavailablePointerDown(tapCell);
            }
          }
          return;
        }
        var source = scheduleDndDrag.source;
        var cell = findDroppableCellFromPoint(event.clientX, event.clientY);
        endScheduleDndDrag();
        if (cell) {
          openScheduleDeskPicker(source, cell.getAttribute('data-date-key'), Number(cell.getAttribute('data-slot-number')));
        }
      }

      function onScheduleDndPointerCancel(event) {
        if (!scheduleDndDrag || event.pointerId !== scheduleDndDrag.pointerId) return;
        endScheduleDndDrag();
      }

      function onScheduleDndPointerDown(event) {
        if (!DATA.scheduleDndEnabled) return;
        if (event.button !== 0) return;
        var target = event.target;
        if (!(target instanceof HTMLElement)) return;
        var card = target.closest('.lesson-card.is-draggable[data-role="lesson-card-draggable"]');
        if (!card || !(card instanceof HTMLElement)) return;
        var cell = card.closest('td[data-role="student-slot-cell"]');
        if (!cell || !(cell instanceof HTMLElement)) return;
        // 掴んだ瞬間に空きコマトグル等の後続ハンドラを止める(同じ pagesElement 上の別 pointerdown を抑止)。
        event.preventDefault();
        event.stopImmediatePropagation();
        cancelScheduleDndInteraction();
        scheduleDndDrag = {
          phase: 'pending',
          pointerId: event.pointerId,
          startX: event.clientX,
          startY: event.clientY,
          card: card,
          ghost: null,
          source: {
            entryId: card.getAttribute('data-entry-id') || '',
            studentId: card.getAttribute('data-linked-student-id') || '',
            lessonType: card.getAttribute('data-lesson-type') || '',
            subject: card.getAttribute('data-subject') || '',
            studentName: card.getAttribute('data-student-name') || '',
            sourceDateKey: cell.getAttribute('data-date-key') || '',
            sourceSlotNumber: Number(cell.getAttribute('data-slot-number')),
          },
        };
        document.addEventListener('pointermove', onScheduleDndPointerMove, true);
        document.addEventListener('pointerup', onScheduleDndPointerUp, true);
        document.addEventListener('pointercancel', onScheduleDndPointerCancel, true);
        var downX = event.clientX;
        var downY = event.clientY;
        scheduleDndLongPressTimer = window.setTimeout(function() {
          scheduleDndLongPressTimer = null;
          startScheduleDndDrag(downX, downY);
        }, 250);
      }

      function closeScheduleDeskPicker() {
        if (scheduleDeskPickerKeydown) { document.removeEventListener('keydown', scheduleDeskPickerKeydown, true); scheduleDeskPickerKeydown = null; }
        if (scheduleDeskPickerOverlay && scheduleDeskPickerOverlay.parentNode) {
          scheduleDeskPickerOverlay.parentNode.removeChild(scheduleDeskPickerOverlay);
        }
        scheduleDeskPickerOverlay = null;
      }

      // 盤面の1コマと同じ「1机=1行 [机番号][講師][席1][席2]」の席セル(td)を返す。
      // 空席=クリックで配置 / 在席=クリックで入れ替え(盤面の入れ替えと同じ) / メモ=選択不可。
      // 席セルには机同一性(deskId/講師)を持たせ、在席席には相手の entryId も持たせて、確定時に実机・実席へ解決させる。
      function renderDeskPickerSeatCellHtml(desk, seat) {
        if (!seat) return '<td class="dp-student dp-blocked"></td>';
        if (seat.blockedByMemo) return '<td class="dp-student dp-blocked">メモ</td>';
        // この机の在席者(両席)の entryId。盤面側で「その机」を在席同一性で特定するために持たせる。
        var deskOccupants = (desk.seats || []).map(function(s) { return s && s.occupantEntryId ? s.occupantEntryId : ''; }).filter(Boolean).join(',');
        var idAttrs = ' data-role="desk-picker-seat"'
          + ' data-desk-index="' + desk.deskIndex + '"'
          + ' data-student-index="' + seat.studentIndex + '"'
          + ' data-desk-id="' + escapeHtml(desk.deskId || '') + '"'
          + ' data-desk-teacher="' + escapeHtml(desk.teacher || '') + '"'
          + ' data-desk-occupants="' + escapeHtml(deskOccupants) + '"';
        if (seat.occupied) {
          return '<td class="dp-student dp-occupied dp-swap"' + idAttrs
            + ' data-occupant-entry-id="' + escapeHtml(seat.occupantEntryId || '') + '">'
            + escapeHtml(seat.label || '使用中') + '<span class="dp-swap-hint">入替</span></td>';
        }
        // 出席済みなど配置不可の記録席(selectable:false)は空きに見せず、記録ラベルでブロック表示する。
        // (欠席/振無休は selectable:true のままなので、この分岐には入らず従来どおり選択可)
        if (!seat.selectable) {
          return '<td class="dp-student dp-blocked">' + escapeHtml(seat.statusLabel || '不可') + '</td>';
        }
        var emptyText = seat.statusLabel ? escapeHtml(seat.statusLabel) : '空き';
        return '<td class="dp-student dp-selectable"' + idAttrs + '><span class="dp-empty">' + emptyText + '</span></td>';
      }

      // 移動先コマを「盤面の一コマをそのまま切り取った」表で出す机選択モーダル。上=日付行・左=時限列・
      // 各行=机([机番号][講師][席1][席2])。物理的な空き席だけ選べる。説明テキストは置かない(盤面と同じ見た目)。
      function openScheduleDeskPicker(source, targetDateKey, targetSlotNumber) {
        var payloadCell = findScheduleCellForMove(targetDateKey, targetSlotNumber);
        if (!payloadCell || !Array.isArray(payloadCell.pickerDesks) || payloadCell.pickerDesks.length === 0) return;
        closeScheduleDeskPicker();
        var desks = payloadCell.pickerDesks;
        var deskCount = desks.length;
        var timeCellHtml = escapeHtml(payloadCell.slotLabel || (targetSlotNumber + '限'))
          + '<br><span class="dp-time-range">' + escapeHtml(payloadCell.timeLabel || '') + '</span>';
        var rowsHtml = desks.map(function(desk, rowIndex) {
          var seats = desk.seats || [];
          var timeCell = rowIndex === 0 ? '<td class="dp-time" rowspan="' + deskCount + '">' + timeCellHtml + '</td>' : '';
          return '<tr>' + timeCell
            + '<td class="dp-seatno">' + (Number(desk.deskIndex) + 1) + '</td>'
            + '<td class="dp-teacher">' + escapeHtml(desk.teacher || '') + '</td>'
            + renderDeskPickerSeatCellHtml(desk, seats[0])
            + renderDeskPickerSeatCellHtml(desk, seats[1])
            + '</tr>';
        }).join('');
        var dateHeadHtml = escapeHtml((payloadCell.dateLabel || targetDateKey) + '(' + (payloadCell.dayLabel || '') + ')');
        var overlay = document.createElement('div');
        overlay.className = 'desk-picker-overlay';
        overlay.setAttribute('data-role', 'desk-picker-overlay');
        overlay.innerHTML = '<div class="desk-picker-modal" role="dialog" aria-modal="true">'
          + '<table class="desk-picker-board"><thead><tr><th class="dp-corner"></th><th class="dp-datehead" colspan="4">' + dateHeadHtml + '</th></tr></thead><tbody>' + rowsHtml + '</tbody></table>'
          + '<div class="desk-picker-actions"><button type="button" class="desk-picker-cancel" data-role="desk-picker-cancel">キャンセル</button></div></div>';
        overlay.addEventListener('click', function(event) {
          var clickTarget = event.target;
          if (!(clickTarget instanceof HTMLElement)) return;
          if (clickTarget === overlay || clickTarget.closest('[data-role="desk-picker-cancel"]')) { closeScheduleDeskPicker(); return; }
          var seatButton = clickTarget.closest('[data-role="desk-picker-seat"]');
          if (!seatButton || !(seatButton instanceof HTMLElement)) return;
          sendScheduleMoveRequest(source, {
            targetDateKey: targetDateKey,
            targetSlotNumber: targetSlotNumber,
            deskIndex: Number(seatButton.getAttribute('data-desk-index')),
            studentIndex: Number(seatButton.getAttribute('data-student-index')),
            deskId: seatButton.getAttribute('data-desk-id') || undefined,
            deskTeacher: seatButton.getAttribute('data-desk-teacher') || '',
            occupantEntryId: seatButton.getAttribute('data-occupant-entry-id') || undefined,
            deskOccupantEntryIds: (seatButton.getAttribute('data-desk-occupants') || '').split(',').filter(Boolean),
          });
          closeScheduleDeskPicker();
        });
        scheduleDeskPickerKeydown = function(event) { if (event.key === 'Escape') closeScheduleDeskPicker(); };
        document.addEventListener('keydown', scheduleDeskPickerKeydown, true);
        document.body.appendChild(overlay);
        scheduleDeskPickerOverlay = overlay;
        // 全机を1画面に収める(縦スクロール無し)。computeDeskPickerFitScale と同式(ミラー):
        // 高さ・幅の両方で足りない分だけ縮める(ブラウザ拡大時は viewport の CSS px が縮み縦横ともにはみ出しうる)。
        // avail = max(0, viewport - margin); k = min(1, availH/contentH, availW/contentW)。
        var modalEl = overlay.querySelector('.desk-picker-modal');
        if (modalEl) {
          var rect = modalEl.getBoundingClientRect();
          var availH = Math.max(0, window.innerHeight - 24);
          var availW = Math.max(0, window.innerWidth - 24);
          var kH = (rect.height > 0 && availH > 0) ? availH / rect.height : 1;
          var kW = (rect.width > 0 && availW > 0) ? availW / rect.width : 1;
          var k = Math.min(1, kH, kW);
          if (k < 1) modalEl.style.transform = 'scale(' + k + ')';
        }
      }

      function sendScheduleMoveRequest(source, seat) {
        try {
          if (!window.opener || window.opener.closed) return;
          // 盤面編集→反映の間の同期中スピナーを即時に出す(移動は反映を待つのでスピナーを出す=抑制窓を解除)。
          suppressSyncSpinnerUntil = 0;
          if (typeof showScheduleSyncingOverlay === 'function') showScheduleSyncingOverlay();
          window.opener.postMessage({
            type: 'schedule-student-move-request',
            classroomStorageKey: (DATA.classroomStorageKey || 'default'),
            source: {
              entryId: source.entryId,
              studentId: source.studentId || undefined,
              sourceDateKey: source.sourceDateKey,
              sourceSlotNumber: source.sourceSlotNumber,
              lessonType: source.lessonType,
              subject: source.subject,
              studentName: source.studentName,
            },
            seat: seat,
          }, '*');
        } catch {}
      }

      function setupScheduleDndMove() {
        if (!DATA.scheduleDndEnabled) return;
        // 空きコマトグル(handleUnavailablePointerDown)より先に拾うため、そのハンドラより前に登録する
        // (掴めるカードのときだけ stopImmediatePropagation で後続を止める)。委譲なので再描画に強い。
        pagesElement.addEventListener('pointerdown', onScheduleDndPointerDown);
      }

      // 移動成立コマの黄色ハイライトを現在の描画に適用する。renderStudentPages 後に毎回呼ぶことで、
      // 自動同期の再描画(pagesElement.innerHTML 差し替え)をまたいで数秒間ハイライトを持続させる。
      function applyScheduleMoveHighlight() {
        if (!scheduleMoveHighlightKey || !pagesElement) return;
        var sep = scheduleMoveHighlightKey.indexOf('_');
        if (sep < 0) return;
        var dateKey = scheduleMoveHighlightKey.slice(0, sep);
        var slotNumber = scheduleMoveHighlightKey.slice(sep + 1);
        var cell = pagesElement.querySelector('td[data-role="student-slot-cell"][data-date-key="' + dateKey + '"][data-slot-number="' + slotNumber + '"]');
        if (cell) cell.classList.add('is-move-done-highlight');
      }

      function highlightMovedSlot(dateKey, slotNumber) {
        if (!dateKey || slotNumber === '' || slotNumber == null) return;
        scheduleMoveHighlightKey = dateKey + '_' + slotNumber;
        if (scheduleMoveHighlightTimer) window.clearTimeout(scheduleMoveHighlightTimer);
        applyScheduleMoveHighlight();
        scheduleMoveHighlightTimer = window.setTimeout(function() {
          scheduleMoveHighlightTimer = null;
          scheduleMoveHighlightKey = null;
          if (pagesElement) {
            var nodes = pagesElement.querySelectorAll('.is-move-done-highlight');
            for (var i = 0; i < nodes.length; i++) nodes[i].classList.remove('is-move-done-highlight');
          }
        }, 4000);
      }

      // 保留中のハイライトがあれば、同期スピナーが消えた後に少し間を置いて開始する(昇格は一度きり)。
      function promotePendingScheduleMoveHighlight() {
        if (!pendingScheduleMoveHighlightKey) return;
        var key = pendingScheduleMoveHighlightKey;
        pendingScheduleMoveHighlightKey = null;
        var sep = key.indexOf('_');
        if (sep <= 0) return;
        var d = key.slice(0, sep);
        var s = key.slice(sep + 1);
        window.setTimeout(function() { highlightMovedSlot(d, s); }, 250);
      }

      function closeScheduleMoveError() {
        if (scheduleMoveErrorOverlay && scheduleMoveErrorOverlay.parentNode) scheduleMoveErrorOverlay.parentNode.removeChild(scheduleMoveErrorOverlay);
        scheduleMoveErrorOverlay = null;
      }

      // 移動が成立しなかったときに理由を大きく表示する(「日程表に戻る」で閉じる)。盤面は変わっていない。
      function showScheduleMoveError(reason) {
        closeScheduleMoveError();
        var overlay = document.createElement('div');
        overlay.className = 'move-error-overlay';
        overlay.setAttribute('data-role', 'move-error-overlay');
        overlay.innerHTML = '<div class="move-error-card"><div class="move-error-heading">移動できませんでした</div><div class="move-error-reason">' + escapeHtml(reason || '移動できませんでした。') + '</div></div><button type="button" class="move-error-back" data-role="move-error-back">日程表に戻る</button>';
        overlay.addEventListener('click', function(event) {
          var t = event.target;
          if (!(t instanceof HTMLElement)) return;
          if (t === overlay || t.closest('[data-role="move-error-back"]')) closeScheduleMoveError();
        });
        document.body.appendChild(overlay);
        scheduleMoveErrorOverlay = overlay;
      }

      function handleScheduleMoveResult(message) {
        if (message && message.ok) {
          // 成立: ハイライトは即開始せず保留する。同期中スピナーと4秒ハイライトの窓が被って見えづらいのを
          // 避けるため、スピナーが消えた後(flushIncomingPayload)に開始する。
          pendingScheduleMoveHighlightKey = String(message.targetDateKey || '') + '_' + String(message.targetSlotNumber == null ? '' : message.targetSlotNumber);
          // 保険: メッセージ到着順の都合で既にスピナーが消えている(または無い)場合は、ここで即昇格する。
          if (!scheduleSyncOverlay || scheduleSyncOverlay.hidden) promotePendingScheduleMoveHighlight();
          return;
        }
        // 不成立: 同期スピナーを消し、理由を大きく表示する(盤面は不変)。
        hideScheduleSyncingOverlay();
        showScheduleMoveError(message && message.message ? String(message.message) : '');
      }

      function groupScheduleEntriesBySlot(entries) {
        const map = new Map();
        (entries || []).forEach((entry) => {
          const key = entry.dateKey + '_' + entry.slotNumber;
          if (!map.has(key)) map.set(key, []);
          map.get(key).push(entry);
        });
        return map;
      }

      function getSpecialSessionsForDate(dateKey) {
        return (DATA.specialSessions || []).filter((session) => dateKey >= session.startDate && dateKey <= session.endDate);
      }

      function getUnavailableSlotsForStudent(studentId) {
        const unavailableSlots = new Set();
        (DATA.specialSessions || []).forEach((session) => {
          const input = session.studentInputs && typeof session.studentInputs === 'object' ? session.studentInputs[studentId] : null;
          if (!input || !Array.isArray(input.unavailableSlots)) return;
          input.unavailableSlots.forEach((slotKey) => {
            if (typeof slotKey === 'string' && slotKey) unavailableSlots.add(slotKey);
          });
        });
        return unavailableSlots;
      }

      function getUnavailableSlotsForTeacher(teacherId) {
        const unavailableSlots = new Set();
        (DATA.specialSessions || []).forEach((session) => {
          const input = session.teacherInputs && typeof session.teacherInputs === 'object' ? session.teacherInputs[teacherId] : null;
          if (!input || !Array.isArray(input.unavailableSlots)) return;
          input.unavailableSlots.forEach((slotKey) => {
            if (typeof slotKey === 'string' && slotKey) unavailableSlots.add(slotKey);
          });
        });
        return unavailableSlots;
      }

      // spec-group-lesson §A/§D/§E: 集団授業(中3)の表示・回数ヘルパ。
      var groupClassBandTimes = { '1': '10:00-11:00', '2': '11:10-12:10' };
      function groupClassDisplayLabel(subject) {
        if (subject === '集団理科') return '集団(理科)';
        if (subject === '集団社会') return '集団(社会)';
        return subject;
      }
      function groupClassShortLabel(subject) {
        if (subject === '集団理科') return '集理';
        if (subject === '集団社会') return '集社';
        return subject;
      }
      function getGroupClassEntry(dateKey, band) {
        var entries = DATA.groupClassEntries && typeof DATA.groupClassEntries === 'object' ? DATA.groupClassEntries : {};
        var entry = entries[dateKey + '_' + band];
        return entry && entry.subject ? entry : null;
      }
      function getGroupClassEntriesInRange(startDate, endDate) {
        var entries = DATA.groupClassEntries && typeof DATA.groupClassEntries === 'object' ? DATA.groupClassEntries : {};
        var list = [];
        Object.keys(entries).forEach(function(key) {
          var entry = entries[key];
          if (!entry || !entry.subject) return;
          if (entry.dateKey < startDate || entry.dateKey > endDate) return;
          list.push(entry);
        });
        return list;
      }
      // spec-group-lesson §C: その講習期間に少なくとも1回盤面登録された集団科目だけを返す(集理/集社の順を保つ)。
      // 集団を設定しない講習では空配列。登録ダイアログの集団欄の出し分けに使う。
      function getGroupClassSubjectsInRange(startDate, endDate) {
        var present = {};
        getGroupClassEntriesInRange(startDate, endDate).forEach(function(entry) {
          if (entry && entry.subject) present[entry.subject] = true;
        });
        return ['集団理科', '集団社会'].filter(function(subject) { return present[subject] === true; });
      }
      function getGroupSessionInputForStudent(studentId, dateKey) {
        var sessions = getSpecialSessionsForDate(dateKey);
        for (var i = 0; i < sessions.length; i++) {
          var inputs = sessions[i].studentInputs;
          var input = inputs && typeof inputs === 'object' ? inputs[studentId] : null;
          if (input) return input;
        }
        return null;
      }
      function isGroupRegistered(input) {
        return Boolean(input && input.countSubmitted);
      }
      function isGroupParticipant(input, subject) {
        return Boolean(input && input.groupClassParticipation && input.groupClassParticipation[subject] === true);
      }
      function isInGroupRoster(entry, studentId) {
        var input = getGroupSessionInputForStudent(studentId, entry.dateKey);
        if (isGroupParticipant(input, entry.subject)) return true;
        return Array.isArray(entry.addedStudentIds) && entry.addedStudentIds.indexOf(studentId) >= 0;
      }
      function isGroupAbsent(entry, studentId) {
        return Array.isArray(entry.absentStudentIds) && entry.absentStudentIds.indexOf(studentId) >= 0;
      }
      // 中3生徒の集団行(2バンド)を組み立てる。未登録=中3全員に科目表示、登録後=参加者のみ表示+出欠反映。
      function buildStudentGroupRowsHtml(student, startDate, endDate, dateHeaders) {
        if (!student || student.currentGradeLabel !== '中3') return '';
        if (getGroupClassEntriesInRange(startDate, endDate).length === 0) return '';
        var bands = ['1', '2'];
        var rowsHtml = '';
        bands.forEach(function(band) {
          var cellsHtml = dateHeaders.map(function(dateHeader) {
            var entry = getGroupClassEntry(dateHeader.dateKey, band);
            var classes = ['slot-cell', 'group-slot-cell'];
            if (!dateHeader.isOpenDay) classes.push('is-holiday');
            var inner = '';
            if (entry) {
              var input = getGroupSessionInputForStudent(student.id, dateHeader.dateKey);
              var show = isGroupRegistered(input) ? isInGroupRoster(entry, student.id) : true;
              if (show) {
                var label = groupClassShortLabel(entry.subject);
                if (isGroupRegistered(input) && isGroupAbsent(entry, student.id)) {
                  inner = '<span class="group-slot-label group-slot-absent">' + escapeHtml(label) + '（欠）</span>';
                } else {
                  inner = '<span class="group-slot-label">' + escapeHtml(label) + '</span>';
                }
              }
            }
            return '<td class="' + classes.join(' ') + '"><div class="slot-cell-content">' + inner + '</div></td>';
          }).join('');
          var bt = String(groupClassBandTimes[band] || '').split('-');
          var timeHeader = '<th class="time-col"><div class="time-box"><div class="time-slot">集団</div><div class="time-range"><span class="time-part">' + escapeHtml(bt[0] || '') + '</span><span class="time-part">' + escapeHtml(bt[1] || '') + '</span></div></div></th>';
          rowsHtml += '<tr class="group-class-row">' + timeHeader + cellsHtml + '</tr>';
        });
        return rowsHtml;
      }
      // spec-group-lesson §E: 空フォーマットの集団行(中3想定)。生徒非依存で、盤面に組まれた
      // 集団コマの科目(集理/集社)をそのまま反映する(出欠・名簿は判定しない静的表示)。
      function buildEmptyFormatGroupRowsHtml(startDate, endDate, dateHeaders) {
        if (getGroupClassEntriesInRange(startDate, endDate).length === 0) return '';
        var bands = ['1', '2'];
        var rowsHtml = '';
        bands.forEach(function(band) {
          var cellsHtml = dateHeaders.map(function(dateHeader) {
            var entry = getGroupClassEntry(dateHeader.dateKey, band);
            var classes = ['slot-cell', 'group-slot-cell'];
            if (!dateHeader.isOpenDay) classes.push('is-holiday');
            var inner = entry ? '<span class="group-slot-label">' + escapeHtml(groupClassShortLabel(entry.subject)) + '</span>' : '';
            return '<td class="' + classes.join(' ') + '"><div class="slot-cell-content">' + inner + '</div></td>';
          }).join('');
          var bt = String(groupClassBandTimes[band] || '').split('-');
          var timeHeader = '<th class="time-col"><div class="time-box"><div class="time-slot">集団</div><div class="time-range"><span class="time-part">' + escapeHtml(bt[0] || '') + '</span><span class="time-part">' + escapeHtml(bt[1] || '') + '</span></div></div></th>';
          rowsHtml += '<tr class="group-class-row">' + timeHeader + cellsHtml + '</tr>';
        });
        return rowsHtml;
      }
      // 中3生徒の集団回数(集理/集社)を講習回数表へ注入。希望=範囲内の該当コマ数、実績=出席数。
      function injectGroupClassCounts(student, startDate, endDate, actualCounts, desiredCounts) {
        if (!student || student.currentGradeLabel !== '中3') return;
        getGroupClassEntriesInRange(startDate, endDate).forEach(function(entry) {
          if (!isInGroupRoster(entry, student.id)) return;
          var label = groupClassShortLabel(entry.subject);
          desiredCounts[label] = (desiredCounts[label] || 0) + 1;
          if (!isGroupAbsent(entry, student.id)) actualCounts[label] = (actualCounts[label] || 0) + 1;
        });
      }

      // spec-group-lesson §F: 講師の集団授業(担当一致・出席1名以上で実施)。
      function teacherMatchesGroupEntry(entry, teacher) {
        var name = entry && entry.teacherName ? entry.teacherName : '';
        if (!name || !teacher) return false;
        var key = normalizeTeacherAssignmentName(name);
        return teacher.name === name || teacher.fullName === name
          || normalizeTeacherAssignmentName(teacher.name) === key
          || normalizeTeacherAssignmentName(teacher.fullName) === key;
      }
      function getTeacherGroupEntriesInRange(teacher, startDate, endDate) {
        return getGroupClassEntriesInRange(startDate, endDate).filter(function(entry) {
          return teacherMatchesGroupEntry(entry, teacher);
        });
      }
      // 出席者数(名簿=参加 or 手動追加、欠席を除く)。1名以上で実施扱い。
      function getGroupPresentCount(entry) {
        var roster = {};
        getSpecialSessionsForDate(entry.dateKey).forEach(function(session) {
          var inputs = session.studentInputs && typeof session.studentInputs === 'object' ? session.studentInputs : {};
          Object.keys(inputs).forEach(function(sid) {
            if (isGroupParticipant(inputs[sid], entry.subject)) roster[sid] = true;
          });
        });
        (Array.isArray(entry.addedStudentIds) ? entry.addedStudentIds : []).forEach(function(sid) { roster[sid] = true; });
        var absent = {};
        (Array.isArray(entry.absentStudentIds) ? entry.absentStudentIds : []).forEach(function(sid) { absent[sid] = true; });
        var present = 0;
        Object.keys(roster).forEach(function(sid) { if (!absent[sid]) present += 1; });
        return present;
      }
      // 講師の集団行(2バンド)。担当する集団コマに 集団(理科)/集団(社会) を表示(未実施はグレー)。
      function buildTeacherGroupRowsHtml(teacher, startDate, endDate, dateHeaders) {
        if (!teacher) return '';
        if (getTeacherGroupEntriesInRange(teacher, startDate, endDate).length === 0) return '';
        var bands = ['1', '2'];
        var rowsHtml = '';
        bands.forEach(function(band) {
          var cellsHtml = dateHeaders.map(function(dateHeader) {
            var entry = getGroupClassEntry(dateHeader.dateKey, band);
            var classes = ['slot-cell', 'group-slot-cell'];
            if (!dateHeader.isOpenDay) classes.push('is-holiday');
            var inner = '';
            if (entry && teacherMatchesGroupEntry(entry, teacher)) {
              var label = groupClassShortLabel(entry.subject);
              if (getGroupPresentCount(entry) >= 1) {
                inner = '<span class="group-slot-label">' + escapeHtml(label) + '</span>';
              } else {
                inner = '<span class="group-slot-label group-slot-empty">' + escapeHtml(label) + '（未実施）</span>';
              }
            }
            return '<td class="' + classes.join(' ') + '"><div class="slot-cell-content">' + inner + '</div></td>';
          }).join('');
          var bt = String(groupClassBandTimes[band] || '').split('-');
          var timeHeader = '<th class="time-col"><div class="time-box"><div class="time-slot">集団</div><div class="time-range"><span class="time-part">' + escapeHtml(bt[0] || '') + '</span><span class="time-part">' + escapeHtml(bt[1] || '') + '</span></div></div></th>';
          rowsHtml += '<tr class="group-class-row">' + timeHeader + cellsHtml + '</tr>';
        });
        return rowsHtml;
      }

      function buildDesiredLectureCountMap(student, startDate, endDate) {
        const countMap = {};
        (DATA.specialSessions || []).forEach((session) => {
          if (!session || session.endDate < startDate || session.startDate > endDate) return;
          const input = getStudentSessionInput(student.id, session.id);
          if (!input.countSubmitted) return;
          if (input.regularOnly) return;
          Object.entries(input.subjectSlots || {}).forEach(([subject, value]) => {
            const normalizedSubject = normalizeSubjectForStudent(subject, student, startDate);
            const normalizedValue = Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;
            if (normalizedValue <= 0) return;
            countMap[normalizedSubject] = (countMap[normalizedSubject] || 0) + normalizedValue;
          });
        });
        return countMap;
      }

      // 希望登録(QR提出)の授業時間(60/45分)を正規化科目ごとに集める。未配置でも回数表に分数を出すため。
      // 実配置の noteSuffix が無い科目のフォールバック。科目内で分数が一意のときだけ返す(pickLectureMinutesSuffix)。
      function buildDesiredLectureMinutesMap(student, startDate, endDate) {
        const listBySubject = {};
        (DATA.specialSessions || []).forEach((session) => {
          if (!session || session.endDate < startDate || session.startDate > endDate) return;
          const input = getStudentSessionInput(student.id, session.id);
          if (!input.countSubmitted) return;
          if (input.regularOnly) return;
          const durations = input.subjectDurations || {};
          Object.entries(input.subjectSlots || {}).forEach(([subject, value]) => {
            const normalizedValue = Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0;
            if (normalizedValue <= 0) return;
            const minutes = Number(durations[subject]);
            if (minutes !== 60 && minutes !== 45) return;
            const normalizedSubject = normalizeSubjectForStudent(subject, student, startDate);
            if (!listBySubject[normalizedSubject]) listBySubject[normalizedSubject] = [];
            listBySubject[normalizedSubject].push(String(minutes));
          });
        });
        const map = {};
        Object.keys(listBySubject).forEach((subject) => {
          const suffix = pickLectureMinutesSuffix(listBySubject[subject]);
          if (suffix) map[subject] = suffix;
        });
        return map;
      }

      function areStudentSlotsUnavailable(studentId, slotKeys) {
        if (!studentId || !Array.isArray(slotKeys) || !slotKeys.length) return false;
        const unavailableSlots = getUnavailableSlotsForStudent(studentId);
        return slotKeys.every((slotKey) => unavailableSlots.has(slotKey));
      }

      function areTeacherSlotsUnavailable(teacherId, slotKeys) {
        if (!teacherId || !Array.isArray(slotKeys) || !slotKeys.length) return false;
        const unavailableSlots = getUnavailableSlotsForTeacher(teacherId);
        return slotKeys.every((slotKey) => unavailableSlots.has(slotKey));
      }

      function buildUnavailablePendingKey(viewType, personId, scope, value) {
        return viewType + ':' + personId + ':' + scope + ':' + value;
      }

      function collectUnavailablePendingKeys(viewType, personId, slotKeys) {
        const keys = [];
        const dateKeys = new Set();
        const slotNumbers = new Set();
        sortSlotKeys(slotKeys).forEach((slotKey) => {
          if (!slotKey) return;
          keys.push(buildUnavailablePendingKey(viewType, personId, 'cell', slotKey));
          const parts = slotKey.split('_');
          if (parts[0]) dateKeys.add(parts[0]);
          if (parts[1]) slotNumbers.add(parts[1]);
        });
        dateKeys.forEach((dateKey) => {
          keys.push(buildUnavailablePendingKey(viewType, personId, 'date', dateKey));
        });
        slotNumbers.forEach((slotNumber) => {
          keys.push(buildUnavailablePendingKey(viewType, personId, 'slot', slotNumber));
        });
        return Array.from(new Set(keys));
      }

      function syncPendingUnavailableUi(root) {
        if (!(root instanceof HTMLElement)) return;
        root.querySelectorAll('[data-pending-unavailable-key]').forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          const pendingKey = element.getAttribute('data-pending-unavailable-key') || '';
          const isPending = Boolean(pendingKey) && pendingUnavailableKeys.has(pendingKey);
          element.classList.toggle('is-pending', isPending);
          if (isPending) element.setAttribute('aria-busy', 'true');
          else element.removeAttribute('aria-busy');
          if (element instanceof HTMLButtonElement) {
            element.disabled = isPending;
          }
        });
      }

      function setUnavailablePending(keys, durationMs) {
        const normalizedKeys = Array.from(new Set((keys || []).filter((value) => typeof value === 'string' && value)));
        if (!normalizedKeys.length) return;
        normalizedKeys.forEach((pendingKey) => {
          pendingUnavailableKeys.add(pendingKey);
          const currentTimer = pendingUnavailableTimers.get(pendingKey);
          if (currentTimer) window.clearTimeout(currentTimer);
          pendingUnavailableTimers.set(pendingKey, window.setTimeout(() => {
            pendingUnavailableKeys.delete(pendingKey);
            pendingUnavailableTimers.delete(pendingKey);
            syncPendingUnavailableUi(pagesElement);
          }, durationMs));
        });
        syncPendingUnavailableUi(pagesElement);
      }

      function isUnavailableTogglePending(target) {
        if (!(target instanceof HTMLElement)) return false;
        const pendingElement = target.closest('[data-pending-unavailable-key]');
        if (!(pendingElement instanceof HTMLElement)) return false;
        const pendingKey = pendingElement.getAttribute('data-pending-unavailable-key') || '';
        return Boolean(pendingKey) && pendingUnavailableKeys.has(pendingKey);
      }

      function getEditableStudentSlotKeys(studentId, dateHeaders, slotNumbers, cellMap, filters) {
        const slotKeys = [];
        dateHeaders.forEach((dateHeader) => {
          if (filters && filters.dateKey && filters.dateKey !== dateHeader.dateKey) return;
          if (!getEditableSpecialSessionsForStudent(studentId, dateHeader.dateKey).length) return;
          slotNumbers.forEach((slotNumber) => {
            if (filters && filters.slotNumber && Number(filters.slotNumber) !== slotNumber) return;
            const slotKey = dateHeader.dateKey + '_' + slotNumber;
            const cell = cellMap.get(slotKey);
            if (!dateHeader.isOpenDay || (cell && !cell.isOpenDay)) return;
            slotKeys.push(slotKey);
          });
        });
        return sortSlotKeys(slotKeys);
      }

      function getEditableTeacherSlotKeys(teacherId, dateHeaders, slotNumbers, cellMap, filters) {
        const slotKeys = [];
        dateHeaders.forEach((dateHeader) => {
          if (filters && filters.dateKey && filters.dateKey !== dateHeader.dateKey) return;
          if (!getEditableSpecialSessionsForTeacher(teacherId, dateHeader.dateKey).length) return;
          slotNumbers.forEach((slotNumber) => {
            if (filters && filters.slotNumber && Number(filters.slotNumber) !== slotNumber) return;
            const slotKey = dateHeader.dateKey + '_' + slotNumber;
            const cell = cellMap.get(slotKey);
            if (!dateHeader.isOpenDay || (cell && !cell.isOpenDay)) return;
            slotKeys.push(slotKey);
          });
        });
        return sortSlotKeys(slotKeys);
      }

      function getAssignedStudentSlotKeys(studentId) {
        const assignedSlotKeys = new Set();
        const student = (DATA.students || []).find((entry) => entry.id === studentId);
        const candidateNames = new Set([
          student && typeof student.name === 'string' ? student.name : '',
          student && typeof student.fullName === 'string' ? student.fullName : '',
        ].filter(Boolean));

        (DATA.cells || []).forEach((cell) => {
          (cell.desks || []).forEach((desk) => {
            const students = desk.lesson && Array.isArray(desk.lesson.students) ? desk.lesson.students : [];
            if (students.some((entry) => entry && entry.lessonType !== 'trial' && (entry.linkedStudentId === studentId || candidateNames.has(entry.name)))) {
              assignedSlotKeys.add(cell.dateKey + '_' + cell.slotNumber);
            }
          });
        });

        return assignedSlotKeys;
      }

      function countAvailableStudentSlotsForSession(studentId, sessionId) {
        if (!studentId || !sessionId) return 0;
        const session = getSpecialSessionById(sessionId);
        if (!session) return 0;
        const dateHeaders = buildDateHeaders(session.startDate, session.endDate);
        const slotNumbers = getSlotNumbers();
        const cellMap = buildCellMap(DATA.cells || []);
        const editableSlotKeys = getEditableStudentSlotKeys(studentId, dateHeaders, slotNumbers, cellMap);
        const unavailableSlots = getUnavailableSlotsForStudent(studentId);
        const assignedSlotKeys = getAssignedStudentSlotKeys(studentId);
        return editableSlotKeys.filter((slotKey) => !unavailableSlots.has(slotKey) && !assignedSlotKeys.has(slotKey)).length;
      }

      function updateUnavailableSlotsLocally(sessionId, personId, unavailableSlots) {
        DATA.specialSessions = (DATA.specialSessions || []).map((session) => {
          if (session.id !== sessionId) return session;
          const currentInput = session.studentInputs?.[personId] || defaultStudentSessionInput();
          return {
            ...session,
            studentInputs: {
              ...(session.studentInputs || {}),
              [personId]: {
                unavailableSlots: sortSlotKeys(unavailableSlots),
                subjectSlots: normalizeSubjectSlots(currentInput.subjectSlots),
                regularOnly: Boolean(currentInput.regularOnly),
                countSubmitted: Boolean(currentInput.countSubmitted),
                // 講習集計結果の提出日時/方法は登録状況を変えないこの操作では保全する。
                submittedAt: currentInput.submittedAt || null,
                submissionMethod: currentInput.submissionMethod,
              },
            },
          };
        });
      }

      function updateStudentCountLocally(sessionId, personId, subjectSlots, regularOnly, countSubmitted, groupClassParticipation, optionChecks, subjectDurations) {
        DATA.specialSessions = (DATA.specialSessions || []).map((session) => {
          if (session.id !== sessionId) return session;
          const currentInput = session.studentInputs?.[personId] || defaultStudentSessionInput();
          return {
            ...session,
            studentInputs: {
              ...(session.studentInputs || {}),
              [personId]: {
                unavailableSlots: sortSlotKeys(currentInput.unavailableSlots),
                subjectSlots: regularOnly ? {} : normalizeSubjectSlots(subjectSlots),
                // 科目ごとの授業時間(分)。登録時は渡された値を採用、未指定は既存を保全(QR提出値を消さない)。regularOnly は空。
                subjectDurations: regularOnly ? {} : (subjectDurations !== undefined ? normalizeSubjectDurations(subjectDurations) : normalizeSubjectDurations(currentInput.subjectDurations)),
                // spec-group-lesson §C: 登録時は渡された集団参加を採用、未指定(登録解除等)は既存を保全して消さない。
                groupClassParticipation: groupClassParticipation !== undefined ? (groupClassParticipation || {}) : (currentInput.groupClassParticipation || {}),
                // オプション欄(開発用教室): 登録時は渡されたチェックを採用、未指定は既存を保全(QR提出値を消さない)。
                optionChecks: optionChecks !== undefined ? (optionChecks || {}) : (currentInput.optionChecks || {}),
                regularOnly: Boolean(regularOnly),
                countSubmitted: Boolean(countSubmitted),
                // 講習集計結果: 室長の登録操作なので即時に method='manual'・日時=今。解除は日時/方法をクリア。
                // (opener 側の schedule-student-count-save と同じ規則。最新表示前でも集計結果に反映される)
                submittedAt: countSubmitted ? new Date().toISOString() : null,
                submissionMethod: countSubmitted ? 'manual' : undefined,
              },
            },
          };
        });
        // オプション欄(開発用教室): 右列の✓は DATA.students[].optionChecks から描画される
        // (buildStudentPayload が表示中セッションの studentInput.optionChecks を載せる)。
        // セッション入力だけ更新しても render() は生徒オブジェクトの古い値を読むため反映されない。
        // 登録ダイアログで渡されたチェックを生徒にもミラーして即時反映する(未指定=保全)。
        if (optionChecks !== undefined) {
          var optionCheckTargetStudent = (DATA.students || []).find(function(s) { return s.id === personId; });
          if (optionCheckTargetStudent) optionCheckTargetStudent.optionChecks = optionChecks || {};
        }
      }

      function updateTeacherUnavailableSlotsLocally(sessionId, personId, unavailableSlots) {
        DATA.specialSessions = (DATA.specialSessions || []).map((session) => {
          if (session.id !== sessionId) return session;
          const currentInput = session.teacherInputs?.[personId] || defaultTeacherSessionInput();
          return {
            ...session,
            teacherInputs: {
              ...(session.teacherInputs || {}),
              [personId]: {
                unavailableSlots: sortSlotKeys(unavailableSlots),
                countSubmitted: Boolean(currentInput.countSubmitted),
                // 提出日時/方法は登録状況を変えないこの操作では保全する。
                submittedAt: currentInput.submittedAt || null,
                submissionMethod: currentInput.submissionMethod,
              },
            },
          };
        });
      }

      function updateTeacherCountLocally(sessionId, personId, countSubmitted) {
        DATA.specialSessions = (DATA.specialSessions || []).map((session) => {
          if (session.id !== sessionId) return session;
          const currentInput = session.teacherInputs?.[personId] || defaultTeacherSessionInput();
          return {
            ...session,
            teacherInputs: {
              ...(session.teacherInputs || {}),
              [personId]: {
                unavailableSlots: sortSlotKeys(currentInput.unavailableSlots),
                countSubmitted: Boolean(countSubmitted),
                // 講習集計結果(講師): 室長の登録操作なので即時に method='manual'・日時=今。解除はクリア。
                submittedAt: countSubmitted ? new Date().toISOString() : null,
                submissionMethod: countSubmitted ? 'manual' : undefined,
              },
            },
          };
        });
      }

      function persistUnavailableSlots(sessionId, personId, unavailableSlots) {
        try {
          if (!window.opener || window.opener.closed) return;
          window.opener.postMessage({
            type: 'schedule-student-unavailable-save',
            sessionId,
            personId,
            unavailableSlots: sortSlotKeys(unavailableSlots),
          }, '*');
        } catch {}
      }

      function persistStudentCount(sessionId, personId, subjectSlots, regularOnly, countSubmitted, groupClassParticipation, optionChecks, subjectDurations) {
        try {
          if (!window.opener || window.opener.closed) return;
          const message = {
            type: 'schedule-student-count-save',
            sessionId,
            personId,
            subjectSlots: regularOnly ? {} : normalizeSubjectSlots(subjectSlots),
            regularOnly: Boolean(regularOnly),
            countSubmitted: Boolean(countSubmitted),
          };
          // spec-group-lesson §C: 集団参加は登録時のみ明示送信(未指定時は既存保全)。
          if (groupClassParticipation !== undefined) message.groupClassParticipation = groupClassParticipation || {};
          // オプション欄(開発用教室): チェックも登録時のみ明示送信(未指定時は既存保全)。
          if (optionChecks !== undefined) message.optionChecks = optionChecks || {};
          // 科目ごとの授業時間(分): 登録時のみ明示送信(未指定時は opener 側で既存保全)。
          if (subjectDurations !== undefined) message.subjectDurations = normalizeSubjectDurations(subjectDurations);
          window.opener.postMessage(message, '*');
        } catch {}
      }

      function persistTeacherUnavailableSlots(sessionId, personId, unavailableSlots) {
        try {
          if (!window.opener || window.opener.closed) return;
          window.opener.postMessage({
            type: 'schedule-teacher-unavailable-save',
            sessionId,
            personId,
            unavailableSlots: sortSlotKeys(unavailableSlots),
          }, '*');
        } catch {}
      }

      function persistTeacherCount(sessionId, personId, countSubmitted) {
        try {
          if (!window.opener || window.opener.closed) return;
          window.opener.postMessage({
            type: 'schedule-teacher-count-save',
            sessionId,
            personId,
            countSubmitted: Boolean(countSubmitted),
          }, '*');
        } catch {}
      }

      function applyStudentUnavailableSlots(studentId, slotKeys) {
        if (!studentId || !Array.isArray(slotKeys) || !slotKeys.length) return;
        const normalizedSlotKeys = sortSlotKeys(Array.from(new Set(slotKeys.filter((slotKey) => typeof slotKey === 'string' && slotKey))));
        if (!normalizedSlotKeys.length) return;
        setUnavailablePending(collectUnavailablePendingKeys('student', studentId, normalizedSlotKeys), 220);

        const targetSessions = new Map();
        normalizedSlotKeys.forEach((slotKey) => {
          const [dateKey] = slotKey.split('_');
          if (!dateKey) return;
          getEditableSpecialSessionsForStudent(studentId, dateKey).forEach((session) => {
            targetSessions.set(session.id, session);
          });
        });
        if (!targetSessions.size) return;

        const shouldSelect = normalizedSlotKeys.some((slotKey) => !getUnavailableSlotsForStudent(studentId).has(slotKey));

        Array.from(targetSessions.values()).forEach((session) => {
          const currentSlots = new Set(session.studentInputs?.[studentId]?.unavailableSlots || []);
          normalizedSlotKeys.forEach((slotKey) => {
            const [dateKey] = slotKey.split('_');
            if (!dateKey || dateKey < session.startDate || dateKey > session.endDate) return;
            if (shouldSelect) currentSlots.add(slotKey);
            else currentSlots.delete(slotKey);
          });
          const nextSlots = sortSlotKeys(Array.from(currentSlots));
          updateUnavailableSlotsLocally(session.id, studentId, nextSlots);
          persistUnavailableSlots(session.id, studentId, nextSlots);
        });

        syncPayloadFingerprint();
        refreshStudentUnavailableUi(studentId);
        // 連続入力の妨げになる同期スピナーを抑制(この操作はローカル反映済み・エコーに描画変化なし)。
        suppressSyncSpinnerUntil = Date.now() + 3000;
      }

      function toggleStudentUnavailableSlot(studentId, slotKey) {
        applyStudentUnavailableSlots(studentId, [slotKey]);
      }

      function applyTeacherUnavailableSlots(teacherId, slotKeys) {
        if (!teacherId || !Array.isArray(slotKeys) || !slotKeys.length) return;
        const normalizedSlotKeys = sortSlotKeys(Array.from(new Set(slotKeys.filter((slotKey) => typeof slotKey === 'string' && slotKey))));
        if (!normalizedSlotKeys.length) return;
        setUnavailablePending(collectUnavailablePendingKeys('teacher', teacherId, normalizedSlotKeys), 220);

        const targetSessions = new Map();
        normalizedSlotKeys.forEach((slotKey) => {
          const [dateKey] = slotKey.split('_');
          if (!dateKey) return;
          getEditableSpecialSessionsForTeacher(teacherId, dateKey).forEach((session) => {
            targetSessions.set(session.id, session);
          });
        });
        if (!targetSessions.size) return;

        const shouldSelect = normalizedSlotKeys.some((slotKey) => !getUnavailableSlotsForTeacher(teacherId).has(slotKey));

        Array.from(targetSessions.values()).forEach((session) => {
          const currentSlots = new Set(session.teacherInputs?.[teacherId]?.unavailableSlots || []);
          normalizedSlotKeys.forEach((slotKey) => {
            const [dateKey] = slotKey.split('_');
            if (!dateKey || dateKey < session.startDate || dateKey > session.endDate) return;
            if (shouldSelect) currentSlots.add(slotKey);
            else currentSlots.delete(slotKey);
          });
          const nextSlots = sortSlotKeys(Array.from(currentSlots));
          updateTeacherUnavailableSlotsLocally(session.id, teacherId, nextSlots);
          persistTeacherUnavailableSlots(session.id, teacherId, nextSlots);
        });

        syncPayloadFingerprint();
        refreshTeacherUnavailableUi(teacherId);
        // 連続入力の妨げになる同期スピナーを抑制(この操作はローカル反映済み・エコーに描画変化なし)。
        suppressSyncSpinnerUntil = Date.now() + 3000;
      }

      function toggleTeacherUnavailableSlot(teacherId, slotKey) {
        applyTeacherUnavailableSlots(teacherId, [slotKey]);
      }

      function renderStudentSlotContent(studentId, slotKey, content, title, isDisabled) {
        const hasEditableSession = !isDisabled && getEditableSpecialSessionsForStudent(studentId, slotKey.split('_')[0] || '').length > 0;
        const unavailableSlots = getUnavailableSlotsForStudent(studentId);
        const isUnavailable = unavailableSlots.has(slotKey);
        const pendingKey = buildUnavailablePendingKey('student', studentId, 'cell', slotKey);
        if (!hasEditableSession) {
          return '<div class="slot-static">' + content + '</div>';
        }
        const buttonClasses = ['slot-button'];
        if (isUnavailable) buttonClasses.push('is-unavailable');
        return '<button type="button" class="' + buttonClasses.join(' ') + '" data-role="toggle-student-unavailable" data-student-id="' + studentId + '" data-slot-key="' + slotKey + '" data-pending-unavailable-key="' + pendingKey + '" data-testid="student-schedule-cell-button-' + studentId + '-' + slotKey + '"' + (title ? ' title="' + escapeHtml(title) + '"' : '') + '>' + content + '</button>';
      }

      function renderStudentDateHeaderCell(studentId, dateHeader, slotNumbers, cellMap) {
        const slotKeys = getEditableStudentSlotKeys(studentId, [dateHeader], slotNumbers, cellMap);
        const headerClass = !dateHeader.isOpenDay ? 'holiday-col' : '';
        const labelHtml = '<span class="date-label">' + Number(dateHeader.dateKey.split('-')[2]) + '</span>';
        if (!slotKeys.length) return '<th class="' + headerClass + '">' + labelHtml + '</th>';
        const buttonClasses = ['header-toggle'];
        if (areStudentSlotsUnavailable(studentId, slotKeys)) buttonClasses.push('is-unavailable');
        return '<th class="' + headerClass + '"><button type="button" class="' + buttonClasses.join(' ') + '" data-role="toggle-student-unavailable-date" data-student-id="' + studentId + '" data-date-key="' + dateHeader.dateKey + '" data-pending-unavailable-key="' + buildUnavailablePendingKey('student', studentId, 'date', dateHeader.dateKey) + '" data-testid="student-schedule-day-toggle-' + studentId + '-' + dateHeader.dateKey + '" title="この日の出席不可を一括切替">' + labelHtml + '</button></th>';
      }

      function renderTeacherDateHeaderCell(teacherId, dateHeader, slotNumbers, cellMap) {
        const slotKeys = getEditableTeacherSlotKeys(teacherId, [dateHeader], slotNumbers, cellMap);
        const headerClass = !dateHeader.isOpenDay ? 'holiday-col' : '';
        const labelHtml = '<span class="date-label">' + Number(dateHeader.dateKey.split('-')[2]) + '</span>';
        if (!slotKeys.length) return '<th class="' + headerClass + '">' + labelHtml + '</th>';
        const buttonClasses = ['header-toggle'];
        if (areTeacherSlotsUnavailable(teacherId, slotKeys)) buttonClasses.push('is-unavailable');
        return '<th class="' + headerClass + '"><button type="button" class="' + buttonClasses.join(' ') + '" data-role="toggle-teacher-unavailable-date" data-teacher-id="' + teacherId + '" data-date-key="' + dateHeader.dateKey + '" data-pending-unavailable-key="' + buildUnavailablePendingKey('teacher', teacherId, 'date', dateHeader.dateKey) + '" data-testid="teacher-schedule-day-toggle-' + teacherId + '-' + dateHeader.dateKey + '" title="この日の参加不可を一括切替">' + labelHtml + '</button></th>';
      }

      function renderStudentTimeHeaderCell(studentId, timeLabel, slotNumber, dateHeaders, cellMap) {
        const slotKeys = getEditableStudentSlotKeys(studentId, dateHeaders, [slotNumber], cellMap);
        if (!slotKeys.length) return renderTimeHeaderCell(timeLabel, slotNumber);
        const buttonClasses = ['header-toggle'];
        if (areStudentSlotsUnavailable(studentId, slotKeys)) buttonClasses.push('is-unavailable');
        const actionHtml = '<button type="button" class="' + buttonClasses.join(' ') + '" data-role="toggle-student-unavailable-slot" data-student-id="' + studentId + '" data-slot-number="' + slotNumber + '" data-pending-unavailable-key="' + buildUnavailablePendingKey('student', studentId, 'slot', String(slotNumber)) + '" data-testid="student-schedule-slot-toggle-' + studentId + '-' + slotNumber + '" title="この時限の出席不可を一括切替">__CONTENT__</button>';
        return renderTimeHeaderCell(timeLabel, slotNumber, actionHtml);
      }

      function renderTeacherTimeHeaderCell(teacherId, timeLabel, slotNumber, dateHeaders, cellMap) {
        const slotKeys = getEditableTeacherSlotKeys(teacherId, dateHeaders, [slotNumber], cellMap);
        if (!slotKeys.length) return renderTimeHeaderCell(timeLabel, slotNumber);
        const buttonClasses = ['header-toggle'];
        if (areTeacherSlotsUnavailable(teacherId, slotKeys)) buttonClasses.push('is-unavailable');
        const actionHtml = '<button type="button" class="' + buttonClasses.join(' ') + '" data-role="toggle-teacher-unavailable-slot" data-teacher-id="' + teacherId + '" data-slot-number="' + slotNumber + '" data-pending-unavailable-key="' + buildUnavailablePendingKey('teacher', teacherId, 'slot', String(slotNumber)) + '" data-testid="teacher-schedule-slot-toggle-' + teacherId + '-' + slotNumber + '" title="この時限の参加不可を一括切替">__CONTENT__</button>';
        return renderTimeHeaderCell(timeLabel, slotNumber, actionHtml);
      }

      function renderStudentPeriodBandCell(studentId, segment) {
        if (segment.type === 'gap') return '<th class="period-gap" colspan="' + segment.colSpan + '"></th>';
        if (!segment.sessionId) return '<th class="period-band" colspan="' + segment.colSpan + '"><span class="period-pill">' + renderPeriodPill(segment) + '</span></th>';
        const input = getStudentSessionInput(studentId, segment.sessionId);
        const buttonClasses = ['period-pill-button'];
        if (input.countSubmitted) buttonClasses.push('is-registered');
        const stateLabel = input.countSubmitted ? '希望科目数登録済' : '希望科目数設定はここをクリック';
        return '<th class="period-band" colspan="' + segment.colSpan + '"><button type="button" class="' + buttonClasses.join(' ') + '" data-role="open-student-count-modal" data-student-id="' + studentId + '" data-session-id="' + segment.sessionId + '" data-testid="student-schedule-period-button-' + studentId + '-' + segment.sessionId + '"><span class="period-pill">' + renderPeriodPill(segment, escapeHtml(stateLabel)) + '</span></button></th>';
      }

      function renderTeacherPeriodBandCell(teacherId, segment) {
        if (segment.type === 'gap') return '<th class="period-gap" colspan="' + segment.colSpan + '"></th>';
        if (!segment.sessionId) return '<th class="period-band" colspan="' + segment.colSpan + '"><span class="period-pill">' + renderPeriodPill(segment) + '</span></th>';
        const input = getTeacherSessionInput(teacherId, segment.sessionId);
        const buttonClasses = ['period-pill-button'];
        if (input.countSubmitted) buttonClasses.push('is-registered');
        const stateLabel = input.countSubmitted ? '講師予定登録済' : '講師予定をここをクリックして登録';
        return '<th class="period-band" colspan="' + segment.colSpan + '"><button type="button" class="' + buttonClasses.join(' ') + '" data-role="open-teacher-register-modal" data-teacher-id="' + teacherId + '" data-session-id="' + segment.sessionId + '" data-testid="teacher-schedule-period-button-' + teacherId + '-' + segment.sessionId + '"><span class="period-pill">' + renderPeriodPill(segment, escapeHtml(stateLabel)) + '</span></button></th>';
      }

      function refreshStudentUnavailableUi(studentId) {
        if (!studentId) return;
        const section = pagesElement.querySelector('[data-role="student-sheet"][data-student-id="' + studentId + '"]');
        if (!(section instanceof HTMLElement)) {
          render();
          return;
        }

        const unavailableSlots = getUnavailableSlotsForStudent(studentId);

        section.querySelectorAll('[data-role="student-slot-cell"]').forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          const slotKey = element.getAttribute('data-slot-key') || '';
          const isUnavailable = Boolean(slotKey) && unavailableSlots.has(slotKey);
          element.classList.toggle('is-unavailable', isUnavailable);

          const button = element.querySelector('[data-role="toggle-student-unavailable"]');
          if (button instanceof HTMLElement) {
            button.classList.toggle('is-unavailable', isUnavailable);
          }
        });

        section.querySelectorAll('[data-role="toggle-student-unavailable-date"]').forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          const dateKey = element.getAttribute('data-date-key') || '';
          if (!dateKey) return;
          const slotKeys = Array.from(section.querySelectorAll('[data-role="student-slot-cell"][data-editable="true"][data-date-key="' + dateKey + '"]'))
            .map((cell) => cell.getAttribute('data-slot-key') || '')
            .filter(Boolean);
          element.classList.toggle('is-unavailable', slotKeys.length > 0 && slotKeys.every((slotKey) => unavailableSlots.has(slotKey)));
        });

        section.querySelectorAll('[data-role="toggle-student-unavailable-slot"]').forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          const slotNumber = element.getAttribute('data-slot-number') || '';
          if (!slotNumber) return;
          const slotKeys = Array.from(section.querySelectorAll('[data-role="student-slot-cell"][data-editable="true"][data-slot-number="' + slotNumber + '"]'))
            .map((cell) => cell.getAttribute('data-slot-key') || '')
            .filter(Boolean);
          element.classList.toggle('is-unavailable', slotKeys.length > 0 && slotKeys.every((slotKey) => unavailableSlots.has(slotKey)));
        });

        syncPendingUnavailableUi(section);
      }

      function refreshTeacherUnavailableUi(teacherId) {
        if (!teacherId) return;
        const section = pagesElement.querySelector('[data-role="teacher-sheet"][data-teacher-id="' + teacherId + '"]');
        if (!(section instanceof HTMLElement)) {
          render();
          return;
        }

        const unavailableSlots = getUnavailableSlotsForTeacher(teacherId);

        section.querySelectorAll('[data-role="teacher-slot-cell"]').forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          const slotKey = element.getAttribute('data-slot-key') || '';
          const isUnavailable = Boolean(slotKey) && unavailableSlots.has(slotKey);
          element.classList.toggle('is-unavailable', isUnavailable);

          const button = element.querySelector('[data-role="toggle-teacher-unavailable"]');
          if (button instanceof HTMLElement) {
            button.classList.toggle('is-unavailable', isUnavailable);
          }
        });

        section.querySelectorAll('[data-role="toggle-teacher-unavailable-date"]').forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          const dateKey = element.getAttribute('data-date-key') || '';
          if (!dateKey) return;
          const slotKeys = Array.from(section.querySelectorAll('[data-role="teacher-slot-cell"][data-editable="true"][data-date-key="' + dateKey + '"]'))
            .map((cell) => cell.getAttribute('data-slot-key') || '')
            .filter(Boolean);
          element.classList.toggle('is-unavailable', slotKeys.length > 0 && slotKeys.every((slotKey) => unavailableSlots.has(slotKey)));
        });

        section.querySelectorAll('[data-role="toggle-teacher-unavailable-slot"]').forEach((element) => {
          if (!(element instanceof HTMLElement)) return;
          const slotNumber = element.getAttribute('data-slot-number') || '';
          if (!slotNumber) return;
          const slotKeys = Array.from(section.querySelectorAll('[data-role="teacher-slot-cell"][data-editable="true"][data-slot-number="' + slotNumber + '"]'))
            .map((cell) => cell.getAttribute('data-slot-key') || '')
            .filter(Boolean);
          element.classList.toggle('is-unavailable', slotKeys.length > 0 && slotKeys.every((slotKey) => unavailableSlots.has(slotKey)));
        });

        syncPendingUnavailableUi(section);
      }

      function renderTeacherSlotContent(teacherId, slotKey, content, title, isDisabled) {
        const hasEditableSession = !isDisabled && getEditableSpecialSessionsForTeacher(teacherId, slotKey.split('_')[0] || '').length > 0;
        const unavailableSlots = getUnavailableSlotsForTeacher(teacherId);
        const isUnavailable = unavailableSlots.has(slotKey);
        const pendingKey = buildUnavailablePendingKey('teacher', teacherId, 'cell', slotKey);
        if (!hasEditableSession) {
          return '<div class="slot-static">' + content + '</div>';
        }
        const buttonClasses = ['slot-button'];
        if (isUnavailable) buttonClasses.push('is-unavailable');
        return '<button type="button" class="' + buttonClasses.join(' ') + '" data-role="toggle-teacher-unavailable" data-teacher-id="' + teacherId + '" data-slot-key="' + slotKey + '" data-pending-unavailable-key="' + pendingKey + '" data-testid="teacher-schedule-cell-button-' + teacherId + '-' + slotKey + '"' + (title ? ' title="' + escapeHtml(title) + '"' : '') + '>' + content + '</button>';
      }

      function getCompactLessonTypeLabel(lessonType) {
        if (lessonType === 'regular') return '通';
        if (lessonType === 'makeup') return '振';
        if (lessonType === 'special') return '講';
        if (lessonType === 'trial') return '体';
        if (lessonType === 'extra') return '増';
        return lessonTypeLabels[lessonType] || lessonType || '';
      }

      function getCompactStatusLabel(status) {
        if (status === 'absent-no-makeup') return '振無休';
        if (status === 'absent') return '休';
        if (status === 'attended') return '出'; // A4省スペース: 講師セルは1文字表記(tooltip は verbose '出席')
        return '';
      }

      function getVerboseStatusLabel(status) {
        if (status === 'absent-no-makeup') return '振無休';
        if (status === 'absent') return '休み';
        if (status === 'attended') return '出席';
        return '';
      }

      function formatTeacherLessonLabel(student, options) {
        const lessonLabel = getCompactLessonTypeLabel(student.lessonType);
        const statusLabel = options && options.verbose ? getVerboseStatusLabel(student.status) : getCompactStatusLabel(student.status);
        // A4省スペース: 講師セルは科目・種別(通/振/講)・状態(出/休/振無休)を詰めて表記(間の空白なし)。
        if (statusLabel) return [lessonLabel, statusLabel].filter(Boolean).join('');
        const teacherLabel = teacherTypeLabels[student.teacherType] || '';
        return teacherLabel ? lessonLabel + '(' + teacherLabel + ')' : lessonLabel;
      }

      function getTeacherLessonPersonDensityClass(student) {
        const meta = [student.subject, formatTeacherLessonLabel(student)].filter(Boolean).join('');
        const totalLength = String(student.name || '').length + meta.length;
        if (totalLength >= 13) return ' is-ultra-condensed';
        if (totalLength >= 9) return ' is-condensed';
        return '';
      }

      function formatTeacherTooltipEntry(student) {
        const lessonLabel = [lessonTypeLabels[student.lessonType] || student.lessonType, student.subject].filter(Boolean).join(' ');
        if (student.status === 'absent' || student.status === 'absent-no-makeup' || student.status === 'attended') {
          return [getVerboseStatusLabel(student.status), student.name, lessonLabel].filter(Boolean).join(' / ');
        }
        return [student.name, lessonLabel].filter(Boolean).join(' / ');
      }

      // Part1(A4省スペース): 休み(欠席)生徒の席に別生徒が重なってコマの人数が通常の2席を
      // 超えたとき、溢れた休み生徒だけを講師日程表のセルから間引く(縦幅節約)。
      // - 実配置生徒(students)が1人もいなければ何も隠さない(=別生徒が重なっていない単なる休みは残す)。
      // - 出席(attended)実績は席を占有する人としてカウントし、休み/振無休(absent系)だけを間引く。
      // - 溢れた分(合計が2を超える分)の休みだけ隠す。実生徒1+休み1=2人はそのまま。
      // 純粋関数(new Function で単体テスト可)。tooltip には全員を残すので情報はホバーで確認できる。
      function selectVisibleTeacherCellStatuses(students, statuses) {
        var list = (statuses || []).filter(Boolean);
        var active = students || [];
        if (active.length === 0) return list;
        function isAbsent(s) { return !!s && (s.status === 'absent' || s.status === 'absent-no-makeup'); }
        var occupants = active.length + list.filter(function(s) { return !isAbsent(s); }).length;
        var keepAbsent = Math.max(0, 2 - occupants);
        var kept = 0;
        return list.filter(function(s) {
          if (!isAbsent(s)) return true;
          if (kept < keepAbsent) { kept++; return true; }
          return false;
        });
      }

      function renderTeacherCellCard(students, statuses) {
        const people = [...(students || []), ...(statuses || [])];
        const cardClass = 'lesson-card lesson-card-teacher ' + (people.length > 2 ? 'is-multi' : people.length > 1 ? 'is-pair' : 'is-single');
        return '<div class="' + cardClass + '">' + people.map((student) => '<div class="teacher-lesson-person' + getTeacherLessonPersonDensityClass(student) + '"><span class="teacher-lesson-line teacher-lesson-name">' + escapeHtml(student.name) + '</span><span class="teacher-lesson-line teacher-lesson-meta">' + escapeHtml([student.subject + formatScheduleMinutesSuffix(student.noteSuffix), formatTeacherLessonLabel(student)].filter(Boolean).join('')) + '</span></div>').join('') + '</div>';
      }

      function makeCornerYearHtml(dateHeaders) {
        return getVisibleYears(dateHeaders).map((year) => '<span class="time-corner-year">' + year + '</span>').join('');
      }

      function makeMonthHeaderHtml(dateHeaders) {
        return buildMonthGroups(dateHeaders).map((group) => '<th colspan="' + group.count + '">' + group.month + '月</th>').join('');
      }

      function makeDateHeaderHtml(dateHeaders) {
        return dateHeaders.map((header) => '<th class="' + (!header.isOpenDay ? 'holiday-col' : '') + '"><span class="date-label">' + Number(header.dateKey.split('-')[2]) + '</span></th>').join('');
      }

      function makeWeekdayHeaderHtml(dateHeaders) {
        return dateHeaders.map((header) => {
          const cls = [!header.isOpenDay ? 'holiday-col' : '', header.weekday === 0 ? 'weekday-sun' : '', header.weekday === 6 ? 'weekday-sat' : ''].filter(Boolean).join(' ');
          return '<th class="' + cls + '"><span class="weekday-label">' + dayLabels[header.weekday] + '</span></th>';
        }).join('');
      }

      function isHighSchoolOrAbove(grade) {
        return grade === '高1' || grade === '高2' || grade === '高3';
      }

      function buildTeacherSalaryData(entries, teacher, startDate, endDate) {
        var teacherId = teacher && teacher.id ? teacher.id : '';
        // 1名: A90/A60/A45 (中以下), C90/C60/C45 (高以上)
        // 2名: B(中以下) と D(高以上) は 2 人の授業時間ペアごとに集計
        //   ペアキーは "90-90" / "90-60" / "90-45" / "60-60" / "60-45" / "45-45"
        function normalizeMinutes(value) {
          var v = String(value || '').trim();
          if (v === '60') return '60';
          if (v === '45') return '45';
          return '90';
        }
        function pairKey(minutesA, minutesB) {
          var order = { '90': 0, '60': 1, '45': 2 };
          var pair = (order[minutesA] <= order[minutesB])
            ? [minutesA, minutesB]
            : [minutesB, minutesA];
          return pair[0] + '-' + pair[1];
        }
        var counts = {
          A90: 0, A60: 0, A45: 0,
          C90: 0, C60: 0, C45: 0,
          'B90-90': 0, 'B90-60': 0, 'B90-45': 0, 'B60-60': 0, 'B60-45': 0, 'B45-45': 0,
          'D90-90': 0, 'D90-60': 0, 'D90-45': 0, 'D60-60': 0, 'D60-45': 0, 'D45-45': 0,
          G: 0,
        };
        var attendanceDates = {};
        (entries || []).forEach(function(entry) {
          var statuses = (entry.statuses || []).filter(Boolean);
          var attendedStatuses = statuses.filter(function(s) {
            return s.status === 'attended';
          });
          if (attendedStatuses.length === 0) return;
            // C / D は「1人でも高校以上を含む」コマを対象にする。
            var hasHigh = attendedStatuses.some(function(s) { return isHighSchoolOrAbove(s.grade); });
          if (attendedStatuses.length === 1) {
            var minutes = normalizeMinutes(attendedStatuses[0].noteSuffix);
              var rank = hasHigh ? 'C' : 'A';
            counts[rank + minutes] = (counts[rank + minutes] || 0) + 1;
          } else {
            var m1 = normalizeMinutes(attendedStatuses[0].noteSuffix);
            var m2 = normalizeMinutes(attendedStatuses[1].noteSuffix);
              var rank2 = hasHigh ? 'D' : 'B';
            var key = rank2 + pairKey(m1, m2);
            counts[key] = (counts[key] || 0) + 1;
          }
          attendanceDates[entry.dateKey] = true;
        });
        // spec-group-lesson §F: 担当する集団コマで出席1名以上=実施1コマ。専用カテゴリ G。交通費日数にも加算。
        getTeacherGroupEntriesInRange(teacher, startDate, endDate).forEach(function(entry) {
          if (getGroupPresentCount(entry) >= 1) {
            counts.G = (counts.G || 0) + 1;
            attendanceDates[entry.dateKey] = true;
          }
        });
        return {
          counts: counts,
          attendanceDays: Object.keys(attendanceDates).length,
          teacherId: teacherId,
        };
      }

      function renderSalarySection(salaryData) {
        var tid = escapeHtml(salaryData.teacherId);
        var counts = salaryData.counts || {};
        function lessonRow(cat, label) {
          var count = counts[cat] || 0;
          return '<tr><td class="salary-label">' + label + '</td><td class="salary-count" data-salary-cat="' + cat + '">' + count + '</td>' +
            '<td><input class="salary-input" type="number" min="0" data-salary-unit="' + cat + '" data-salary-key="salary-unit-' + cat + '-' + tid + '" /></td>' +
            '<td class="salary-subtotal" data-salary-sub="' + cat + '">0</td></tr>';
        }
        var pairs = ['90-90', '90-60', '90-45', '60-60', '60-45', '45-45'];
        var lessonDefs = [];
        ['90', '60', '45'].forEach(function(m) { lessonDefs.push({ cat: 'A' + m, label: 'A' + m + ' (1名/中学以下/' + m + '分)' }); });
        pairs.forEach(function(p) { lessonDefs.push({ cat: 'B' + p, label: 'B ' + p + ' (2名/中学以下/' + p.replace('-', '+') + '分)' }); });
        ['90', '60', '45'].forEach(function(m) { lessonDefs.push({ cat: 'C' + m, label: 'C' + m + ' (1名/高校以上/' + m + '分)' }); });
        pairs.forEach(function(p) { lessonDefs.push({ cat: 'D' + p, label: 'D ' + p + ' (2名/高校以上/' + p.replace('-', '+') + '分)' }); });
        // spec-group-lesson §F: 集団授業の専用カテゴリ(1コマ単位・単価1種)。
        lessonDefs.push({ cat: 'G', label: '集団 (1コマ)' });
        var visible = lessonDefs.filter(function(d) { return (counts[d.cat] || 0) >= 1; });
        var commuteRow = '<tr><td class="salary-label">交通費</td><td class="salary-count" data-salary-cat="commute">' + salaryData.attendanceDays + '日</td><td><input class="salary-input" type="number" min="0" data-salary-unit="commute" data-salary-key="salary-unit-commute-' + tid + '" /></td><td class="salary-subtotal" data-salary-sub="commute">0</td></tr>';
        var officeRow = '<tr><td class="salary-label">事務給</td><td class="salary-count salary-count-fixed" data-salary-cat="office">-</td><td><input class="salary-input" type="number" min="0" data-salary-unit="office" data-salary-key="salary-unit-office-' + tid + '" data-salary-fixed="1" /></td><td class="salary-subtotal" data-salary-sub="office">0</td></tr>';
        var totalRow = '<tr class="salary-total-row"><td class="salary-label">合計</td><td></td><td></td><td class="salary-grand-total">0</td></tr>';
        // Part3: 振替欄削除で空いた横幅を使い、給与のレッスン行を左右2列に振り分けて縦幅を節約する(常に2列)。
        // 交通費/事務給/合計は下段に全幅で置く。合計は .salary-section 内の全 .salary-input を集計する
        // recalcSalary が担うため、テーブルを分割しても集計は不変(inputは data-salary-key で一意)。
        var salaryColgroup = '<colgroup><col class="salary-col-label"/><col class="salary-col-count"/><col class="salary-col-unit"/><col class="salary-col-sub"/></colgroup>';
        var half = Math.ceil(visible.length / 2);
        function salaryColumnTable(defs) {
          var rows = defs.map(function(d) { return lessonRow(d.cat, d.label); }).join('');
          return '<table class="salary-table salary-col-table" data-salary-teacher-id="' + tid + '">' + salaryColgroup +
            '<thead><tr><th></th><th>コマ数</th><th>単価</th><th>小計</th></tr></thead>' +
            '<tbody>' + rows + '</tbody></table>';
        }
        var columnsHtml = '<div class="salary-columns">' + salaryColumnTable(visible.slice(0, half)) + salaryColumnTable(visible.slice(half)) + '</div>';
        var footHtml = '<table class="salary-table salary-table-foot" data-salary-teacher-id="' + tid + '">' + salaryColgroup +
          '<tbody>' + commuteRow + officeRow + totalRow + '</tbody></table>';
        return '<div class="box-stack salary-section"><div class="box-table-title">給与計算</div>' + columnsHtml + footHtml + '</div>';
      }

      function renderBottomSection(commonKey, individualKey, absenceRows, makeupRows, regularCounts, lectureCounts, regularWarningHtml, lectureWarningHtml, options) {
        const isTeacher = options && options.isTeacher;
        const salaryData = options && options.salaryData;
        const absenceTestId = options && options.absenceTestId ? options.absenceTestId : 'student-schedule-absence-table';
        const absenceSectionHtml = isTeacher
          ? ''
          : '<div class="box-stack"><div class="box-table-title">休み</div><table class="absence-table" data-testid="' + escapeHtml(absenceTestId) + '"><tbody>' + absenceRows + '</tbody></table></div>';
        const salarySectionHtml = isTeacher && salaryData ? renderSalarySection(salaryData) : '';
        if (isTeacher) {
          // Part2(A4省スペース): 振替授業欄は講師日程表から削除。空いた分は給与計算欄(2列)を広げる。
          // 振替コマ自体は週グリッド内に残るので、講師が担当する振替授業が消えるわけではない。
          return '<div class="bottom-grid bottom-grid-teacher">' +
            salarySectionHtml +
            '<div class="count-stack"><div class="count-stack-block"><div><div class="box-table-title">通常回数<span class="print-only-hidden">(希望数)</span></div><table class="count-table"><tbody>' + regularCounts + '</tbody></table></div></div><div class="count-stack-block"><div><div class="box-table-title">講習回数<span class="print-only-hidden">(希望数)</span></div><table class="count-table"><tbody>' + lectureCounts + '</tbody></table></div></div></div>' +
          '</div>';
        }
        const emptyFormat = options && options.emptyFormat;
        const commonNoteValue = emptyFormat ? '' : getScheduleNoteValue(commonKey);
        const individualNoteValue = emptyFormat ? '' : getScheduleNoteValue(individualKey);
        // 空フォーマットは実データ(scheduleNotes)から切り離し、空フォーマット専用ストレージ(data-empty-format-field)に保持する。
        // 通常の生徒日程表は従来どおり memo-input + data-note-key で scheduleNotes に保存する。
        const commonFieldAttr = emptyFormat ? ' data-empty-format-field="common"' : ' data-note-key="' + escapeHtml(commonKey) + '"';
        const individualFieldAttr = emptyFormat ? ' data-empty-format-field="individual"' : ' data-note-key="' + escapeHtml(individualKey) + '"';
        const noteInputClass = emptyFormat ? 'box-textarea' : 'box-textarea memo-input';
        const commonSectionHtml = '<div class="box-stack"><div class="box-table-title">共通連絡事項(学年別)</div><div class="box-panel"><textarea class="' + noteInputClass + '"' + commonFieldAttr + '>' + escapeHtml(commonNoteValue) + '</textarea></div></div>';
        const individualSectionHtml = '<div class="box-stack"><div class="box-table-title">個別連絡事項</div><div class="box-panel"><textarea class="' + noteInputClass + '"' + individualFieldAttr + '>' + escapeHtml(individualNoteValue) + '</textarea></div></div>';
        const makeupSectionHtml = '<div class="box-stack"><div class="box-table-title">振替授業</div><table class="makeup-table"><tbody>' + makeupRows + '</tbody></table></div>';
        const countStackHtml = '<div class="count-stack"><div class="count-stack-block"><div><div class="box-table-title">通常回数<span class="print-only-hidden">(希望数)</span></div><table class="count-table"><tbody>' + regularCounts + '</tbody></table></div>' + (regularWarningHtml || '') + '</div><div class="count-stack-block"><div><div class="box-table-title">講習回数<span class="print-only-hidden">(希望数)</span></div><table class="count-table"><tbody>' + lectureCounts + '</tbody></table></div>' + (lectureWarningHtml || '') + '</div></div>';
        // オプション欄(開発用教室のみ): 休み欄を削除し、振替授業を左へ詰め、空いた所にオプション欄(2列5行)を置く。
        // 左列=学年共通のテキスト入力(scheduleNotes と同じ仕組み)、右列=QR提出のチェック状態(往復処理は次フェーズ。既定は未チェック)。
        if (DATA.optionFieldEnabled) {
          return '<div class="bottom-grid bottom-grid-option">' +
            commonSectionHtml +
            individualSectionHtml +
            makeupSectionHtml +
            renderOptionSection(options && options.optionGradeLabel, options && options.optionChecks, emptyFormat) +
            countStackHtml +
          '</div>';
        }
        return '<div class="bottom-grid">' +
          commonSectionHtml +
          individualSectionHtml +
          absenceSectionHtml +
          makeupSectionHtml +
          countStackHtml +
        '</div>';
      }

      // オプション欄(2列5行)を生成する。左列=学年共通テキスト入力、右列=チェック(1文字分)。
      // gradeLabel ごとに共通の note キー(student-option-grade-{学年}-{行})で保存する。
      function renderOptionSection(gradeLabel, checks, emptyFormat) {
        var grade = gradeLabel || '未設定';
        var rows = '';
        for (var i = 0; i < 5; i++) {
          var noteKey = 'student-option-grade-' + grade + '-' + i;
          var value = emptyFormat ? '' : getScheduleNoteValue(noteKey);
          // 空フォーマットは専用ストレージへ保持(data-empty-format-field="option-N")。通常は scheduleNotes(data-note-key)。
          var inputAttr = emptyFormat ? ' data-empty-format-field="option-' + i + '"' : ' data-note-key="' + escapeHtml(noteKey) + '"';
          var inputClass = emptyFormat ? 'option-input' : 'option-input memo-input';
          // checks は行番号(0..4)キーのレコード(QR提出)または配列。どちらでも i 番目を判定。
          var checked = !!checks && checks[i] === true;
          rows += '<tr>' +
            '<td><input type="text" class="' + inputClass + '"' + inputAttr + ' value="' + escapeHtml(value) + '" /></td>' +
            '<td class="option-check-cell">' + (checked ? '✓' : '') + '</td>' +
            '</tr>';
        }
        return '<div class="box-stack"><div class="box-table-title">オプション</div>' +
          '<table class="option-table"><colgroup><col class="option-col-label"/><col class="option-col-check"/></colgroup><tbody>' + rows + '</tbody></table></div>';
      }

      function formatCompactDateSlot(dateKey, slotNumber) {
        const date = new Date(dateKey + 'T00:00:00');
        return (date.getMonth() + 1) + '/' + date.getDate() + '(' + dayLabels[date.getDay()] + ')' + slotNumber + '限';
      }

      // 振替欄(生徒/講師日程表)用: 枠に収まるよう年(2026/)と曜日(水)を省き、月日と限だけにする。
      function compactMakeupDateSlot(dateKey, slotNumber) {
        const date = new Date(dateKey + 'T00:00:00');
        return (date.getMonth() + 1) + '/' + date.getDate() + ' ' + slotNumber + '限';
      }

      // 振替元ラベルは '2026/4/1(水) 1限' 等。年と曜日を落とし '4/1 1限' に詰める。
      // 注意: この関数はテンプレートリテラル内の埋め込みスクリプト。正規表現のバックスラッシュは
      // テンプレート展開で1段消えるため、出力で \\d 等を残すには必ず二重に書く(\\\\d)。
      function compactMakeupSourceLabel(label) {
        return String(label || '')
          .replace(/^\\s*\\d{4}\\//, '')
          .replace(/\\s*\\([^)]*\\)\\s*/g, ' ')
          .replace(/\\s+/g, ' ')
          .trim();
      }

      function formatMakeupNote(subject, sourceLabel, targetDateKey, targetSlotNumber) {
        if (!sourceLabel) return '';
        return [subject, compactMakeupSourceLabel(sourceLabel), '→', compactMakeupDateSlot(targetDateKey, targetSlotNumber)].filter(Boolean).join(' ');
      }

      function formatTeacherMakeupNote(studentName, subject, sourceLabel, targetDateKey, targetSlotNumber) {
        if (!sourceLabel) return '';
        return [studentName, subject, compactMakeupSourceLabel(sourceLabel), '→', compactMakeupDateSlot(targetDateKey, targetSlotNumber)].filter(Boolean).join(' ');
      }

      function formatAbsenceNote(dateKey, slotNumber, teacherName, subject, lessonType, status) {
        var base = [formatCompactDateSlot(dateKey, slotNumber), teacherName, lessonTypeLabels[lessonType] || lessonType, subject].filter(Boolean).join(' / ');
        if (status === 'absent-no-makeup') base += ' (振無休)';
        if (arguments[6]) base += ' → ' + formatCompactDateSlot(arguments[6], arguments[7]);
        return base;
      }

      function toMakeupRows(makeupNotes, minimumRowCount) {
        return Array.from({ length: Math.max(minimumRowCount, makeupNotes.length) }, (_, rowIndex) => {
          const note = makeupNotes[rowIndex] ?? '';
          const len = note.length;
          const fs = len > 40 ? 'font-size:7px;' : len > 28 ? 'font-size:8px;' : '';
          return '<tr><td colspan="3"' + (fs ? ' style="' + fs + '"' : '') + '>' + escapeHtml(note) + '</td></tr>';
        }).join('');
      }

      function collectStudentMakeupNotes(entries) {
        return entries.reduce((notes, entry) => {
          if (entry.lesson.status === 'absent' || entry.lesson.status === 'absent-no-makeup') return notes;
          if (entry.lesson.lessonType !== 'makeup') return notes;
          const note = formatMakeupNote(entry.lesson.subject, entry.lesson.makeupSourceLabel, entry.dateKey, entry.slotNumber);
          if (note) notes.push(note);
          return notes;
        }, []);
      }

      function collectTeacherMakeupNotes(entries) {
        return entries.reduce((notes, entry) => {
          entry.students.forEach((student) => {
            if (student.lessonType !== 'makeup') return;
            const note = formatTeacherMakeupNote(student.name, student.subject, student.makeupSourceLabel, entry.dateKey, entry.slotNumber);
            if (note) notes.push(note);
          });
          (entry.statuses || []).forEach((student) => {
            if (student.status === 'absent' || student.status === 'absent-no-makeup') return;
            if (student.lessonType !== 'makeup') return;
            const note = formatTeacherMakeupNote(student.name, student.subject, student.makeupSourceLabel, entry.dateKey, entry.slotNumber);
            if (note) notes.push(note);
          });
          return notes;
        }, []);
      }

      function collectStudentAbsenceNotes(cells, student) {
        const notes = [];
        const studentNameKey = normalizeSearchText(student && student.name ? student.name : '');
        const studentFullNameKey = normalizeSearchText(student && student.fullName ? student.fullName : '');
        (cells || []).forEach((cell) => {
          (cell.desks || []).forEach((desk) => {
            const statuses = Array.isArray(desk.statuses) ? desk.statuses : [];
            statuses.forEach((entry) => {
              if (!entry) return;
              if (entry.status !== 'absent' && entry.status !== 'absent-no-makeup') return;
              if (entry.lessonType === 'trial') return;
              const linkedStudentId = entry.linkedStudentId || '';
              const entryNameKey = normalizeSearchText(entry.name || '');
              const isSameStudent = linkedStudentId === student.id
                || (entryNameKey && (entryNameKey === studentNameKey || entryNameKey === studentFullNameKey));
              if (!isSameStudent) return;
              notes.push(formatAbsenceNote(cell.dateKey, cell.slotNumber, entry.teacherName || desk.teacher, entry.subject, entry.lessonType, entry.status, entry.linkedDestinationDateKey, entry.linkedDestinationSlotNumber));
            });
          });
        });
        return notes;
      }

      function renderPeriodPill(segment, stateHtml) {
        return '<span class="period-pill-edge">◀</span><span class="period-pill-center"><span class="period-pill-label">' + escapeHtml(segment.label) + '</span>' + (stateHtml ? '<span class="period-pill-state-inline print-only-hidden">' + stateHtml + '</span>' : '') + '</span><span class="period-pill-edge">▶</span>';
      }

      function renderStudentCountModal() {
        if (!activeCountDialog || !activeCountDialog.studentId || !activeCountDialog.sessionId) return '';
        const student = DATA.students.find((entry) => entry.id === activeCountDialog.studentId);
        const session = getSpecialSessionById(activeCountDialog.sessionId);
        if (!student || !session) return '';
        const referenceDate = startInput.value || DATA.defaultStartDate || DATA.availableStartDate;
        const input = getStudentSessionInput(student.id, session.id);
        const normalizedSubjectSlots = normalizeCountMapSubjects(input.subjectSlots, student, referenceDate);
        const visibleSubjects = getVisibleSubjectsForStudent(student, referenceDate, Object.keys(normalizedSubjectSlots));
        // 科目ごとの授業時間(分)。QRと同じく既定90、60/45を選択可。input.subjectDurations は 60/45 のみ保持。
        const subjectDurations = normalizeSubjectDurations(input.subjectDurations);
        const resolveSubjectDuration = function(subject) {
          var v = subjectDurations[subject];
          return (v === 60 || v === 45) ? v : 90;
        };
        const renderDurationSelect = function(subject) {
          var selected = resolveSubjectDuration(subject);
          var opt = function(min) { return '<option value="' + min + '"' + (selected === min ? ' selected' : '') + '>' + min + '分</option>'; };
          return '<select class="count-modal-duration" data-role="student-count-subject-duration" data-subject="' + subject + '" data-testid="student-schedule-count-duration-' + subject + '"' + (input.regularOnly ? ' disabled' : '') + ' aria-label="' + escapeHtml(subject) + 'の授業時間">' + opt(90) + opt(60) + opt(45) + '</select>';
        };
        const rowsHtml = input.countSubmitted
          ? visibleSubjects.map((subject) => {
              var dur = resolveSubjectDuration(subject);
              var durSuffix = dur === 90 ? '' : ' (' + dur + '分)';
              return '<tr><td>' + escapeHtml(subject) + '</td><td>' + escapeHtml(String(Number(normalizedSubjectSlots[subject] || 0)) + durSuffix) + '</td></tr>';
            }).join('')
          : visibleSubjects.map((subject) => '<tr><td>' + escapeHtml(subject) + '</td><td>' + renderDurationSelect(subject) + '<input type="number" min="0" step="1" value="' + escapeHtml(String(Number(normalizedSubjectSlots[subject] || 0))) + '" data-role="student-count-subject-input" data-subject="' + subject + '" data-testid="student-schedule-count-subject-' + subject + '"' + (input.regularOnly ? ' disabled' : '') + '></td></tr>').join('');
        const actionHtml = input.countSubmitted
          ? '<button type="button" data-role="unsubmit-student-count-modal" data-testid="student-schedule-count-unregister">登録解除</button>'
          : '<button type="button" data-role="submit-student-count-modal" data-testid="student-schedule-count-register">登録</button>';
        const unregisterNote = input.countSubmitted
          ? '<div class="count-modal-note">登録中は編集できません。編集する場合は登録解除して、内容を直してから再度登録してください。</div><div class="count-modal-note">登録解除すると、コマ表からこの生徒だけ外します。講師は残ります。</div>'
          : '';
        const regularOnlyRow = input.countSubmitted
          ? '<tr><td>通常のみ</td><td>' + escapeHtml(input.regularOnly ? 'あり' : 'なし') + '</td></tr>'
          : '<tr><td>通常のみ</td><td><label class="count-modal-check"><input type="checkbox" data-role="student-count-regular-only" data-testid="student-schedule-count-regular-only"' + (input.regularOnly ? ' checked' : '') + '>通常のみ</label></td></tr>';
        // spec-group-lesson §C: 中3のみ集団参加トグル。登録時に「登録」ボタンで集団参加もまとめて保存する(専用ボタンは廃止)。
        // 室長は後から生徒日程表で追加しない運用のため、登録後は読み取り専用表示にする。
        var groupRow = '';
        // spec-group-lesson §C: 集団欄は「その講習に盤面登録された集団科目」がある中3にだけ出す。
        // 集団を設定しない講習では availableGroupSubjects が空になり、行ごと非表示。
        var availableGroupSubjects = getGroupClassSubjectsInRange(session.startDate, session.endDate);
        if (student.currentGradeLabel === '中3' && availableGroupSubjects.length) {
          var gp = input.groupClassParticipation || {};
          if (input.countSubmitted) {
            var participatingGroups = availableGroupSubjects.filter(function(subject) { return gp[subject] === true; });
            groupRow = '<tr><td>集団授業</td><td>' + escapeHtml(participatingGroups.length ? participatingGroups.join(' ') : 'なし') + '</td></tr>';
          } else {
            var groupChecks = availableGroupSubjects.map(function(subject) {
              return '<label class="count-modal-check"><input type="checkbox" data-role="student-count-group-input" data-subject="' + subject + '" data-testid="student-schedule-group-' + subject + '"' + (gp[subject] === true ? ' checked' : '') + '>' + subject + '</label>';
            }).join(' ');
            groupRow = '<tr><td>集団授業</td><td>' + groupChecks + '</td></tr>';
          }
        }
        // オプション欄(開発用教室): 学年共通のオプション文言(空でない行)を登録ダイアログにも反映する。
        // 未登録時はチェックボックス(登録ボタンでまとめて保存)、登録済みは あり/なし の読み取り表示。
        var optionRow = '';
        if (DATA.optionFieldEnabled) {
          var optGrade = student.currentGradeLabel || '未設定';
          var optItems = [];
          for (var oi = 0; oi < 5; oi++) {
            var optLabel = String(getScheduleNoteValue('student-option-grade-' + optGrade + '-' + oi) || '').trim();
            if (optLabel) optItems.push({ index: oi, label: optLabel });
          }
          if (optItems.length) {
            var oc = input.optionChecks || {};
            if (input.countSubmitted) {
              var checkedOptionLabels = optItems.filter(function(it) { return oc[it.index] === true; }).map(function(it) { return it.label; });
              optionRow = '<tr><td>オプション</td><td>' + escapeHtml(checkedOptionLabels.length ? checkedOptionLabels.join(' / ') : 'なし') + '</td></tr>';
            } else {
              var optionChecksHtml = optItems.map(function(it) {
                return '<label class="count-modal-check"><input type="checkbox" data-role="student-count-option-input" data-index="' + it.index + '"' + (oc[it.index] === true ? ' checked' : '') + '>' + escapeHtml(it.label) + '</label>';
              }).join(' ');
              optionRow = '<tr><td>オプション</td><td>' + optionChecksHtml + '</td></tr>';
            }
          }
        }
        return '<div class="count-modal-backdrop" data-role="student-count-modal-backdrop"><div class="count-modal" role="dialog" aria-modal="true" data-testid="student-schedule-count-modal"><div class="count-modal-head"><div class="count-modal-title">' + escapeHtml(formatStudentHeaderName(student, startInput.value || DATA.defaultStartDate || DATA.availableStartDate)) + '</div><div class="count-modal-subtitle">' + escapeHtml(session.label + ' (' + formatMonthDay(session.startDate) + ' - ' + formatMonthDay(session.endDate) + ')') + '</div><div class="count-modal-note">日程表の出席不可コマと講習での希望科目数を登録します。</div>' + unregisterNote + '</div><div class="count-modal-body"><table class="count-modal-table"><tbody>' + rowsHtml + regularOnlyRow + groupRow + optionRow + '</tbody></table></div><div class="count-modal-actions"><button type="button" class="secondary" data-role="close-student-count-modal" data-testid="student-schedule-count-cancel">キャンセル</button>' + actionHtml + '</div></div></div>';
      }

      function renderTeacherRegisterModal() {
        if (!activeTeacherRegisterDialog || !activeTeacherRegisterDialog.teacherId || !activeTeacherRegisterDialog.sessionId) return '';
        const teacher = DATA.teachers.find((entry) => entry.id === activeTeacherRegisterDialog.teacherId);
        const session = getSpecialSessionById(activeTeacherRegisterDialog.sessionId);
        if (!teacher || !session) return '';
        const input = getTeacherSessionInput(teacher.id, session.id);
        const unavailableCount = input.unavailableSlots.filter((slotKey) => {
          const [dateKey] = String(slotKey || '').split('_');
          return Boolean(dateKey) && dateKey >= session.startDate && dateKey <= session.endDate;
        }).length;
        const actionHtml = input.countSubmitted
          ? '<button type="button" data-role="unsubmit-teacher-register-modal" data-testid="teacher-schedule-register-unregister">登録解除</button>'
          : '<button type="button" data-role="submit-teacher-register-modal" data-testid="teacher-schedule-register-submit">登録</button>';
        const unregisterNote = input.countSubmitted
          ? '<div class="count-modal-note">登録解除すると、コマ表からこの講師だけ外します。生徒は残ります。</div>'
          : '<div class="count-modal-note">登録された予定に従い、コマ表に講師名を追加します。</div>';
        return '<div class="count-modal-backdrop" data-role="teacher-register-modal-backdrop"><div class="count-modal" role="dialog" aria-modal="true" data-testid="teacher-schedule-register-modal"><div class="count-modal-head"><div class="count-modal-title">' + escapeHtml(formatTeacherHeaderName(teacher)) + '</div><div class="count-modal-subtitle">' + escapeHtml(session.label + ' (' + formatMonthDay(session.startDate) + ' - ' + formatMonthDay(session.endDate) + ')') + 'の期間に、</div></div><div class="count-modal-body">' + unregisterNote + '<div class="count-modal-note">講師数が多く、机数より多くなる場合はスキップされます。</div></div><div class="count-modal-actions"><button type="button" class="secondary" data-role="close-teacher-register-modal" data-testid="teacher-schedule-register-cancel">キャンセル</button>' + actionHtml + '</div></div></div>';
      }

      function openStudentCountModal(studentId, sessionId) {
        if (!studentId || !sessionId) return;
        activeCountDialog = { studentId, sessionId };
        render();
      }

      function openTeacherRegisterModal(teacherId, sessionId) {
        if (!teacherId || !sessionId) return;
        activeTeacherRegisterDialog = { teacherId, sessionId };
        render();
      }

      function closeStudentCountModal() {
        if (!activeCountDialog) return;
        activeCountDialog = null;
        render();
      }

      function closeTeacherRegisterModal() {
        if (!activeTeacherRegisterDialog) return;
        activeTeacherRegisterDialog = null;
        render();
      }

      function submitStudentCountModal() {
        if (!activeCountDialog || !activeCountDialog.studentId || !activeCountDialog.sessionId) return;
        const regularOnlyElement = document.querySelector('[data-role="student-count-regular-only"]');
        const regularOnly = regularOnlyElement instanceof HTMLInputElement ? Boolean(regularOnlyElement.checked) : false;
        const subjectSlots = {};
        document.querySelectorAll('[data-role="student-count-subject-input"]').forEach((element) => {
          if (!(element instanceof HTMLInputElement)) return;
          const subject = element.getAttribute('data-subject') || '';
          if (!subject) return;
          const normalizedValue = Number.isFinite(Number(element.value)) ? Math.max(0, Math.trunc(Number(element.value))) : 0;
          if (normalizedValue > 0) subjectSlots[subject] = normalizedValue;
        });
        const requestedCount = regularOnly
          ? 0
          : Object.values(subjectSlots).reduce((total, value) => total + (Number.isFinite(Number(value)) ? Math.max(0, Math.trunc(Number(value))) : 0), 0);
        const availableSlotCount = countAvailableStudentSlotsForSession(activeCountDialog.studentId, activeCountDialog.sessionId);
        if (requestedCount > availableSlotCount) {
          alert('希望科目数が出席可能コマ数を上回っているため登録できません。出席不可コマを見直してください。');
          activeCountDialog = null;
          render();
          return;
        }

        // spec-group-lesson §C: 中3の集団参加チェックも「登録」ボタンでまとめて保存する。
        var groupParticipation = {};
        document.querySelectorAll('[data-role="student-count-group-input"]').forEach(function(element) {
          if (!(element instanceof HTMLInputElement)) return;
          var subject = element.getAttribute('data-subject') || '';
          if (subject && element.checked) groupParticipation[subject] = true;
        });
        // オプション欄(開発用教室): 登録ダイアログのチェックをまとめて保存する。行番号(0..4)キー。
        var optionChecks = {};
        document.querySelectorAll('[data-role="student-count-option-input"]').forEach(function(element) {
          if (!(element instanceof HTMLInputElement)) return;
          var idx = element.getAttribute('data-index') || '';
          if (idx !== '' && element.checked) optionChecks[idx] = true;
        });
        // 科目ごとの授業時間(分)。QRと同じく 60/45 のみ保持(90=既定は落とす)。回数0でも保持はせず、希望ありの科目のみ。
        var subjectDurations = {};
        document.querySelectorAll('[data-role="student-count-subject-duration"]').forEach(function(element) {
          if (!(element instanceof HTMLSelectElement)) return;
          var subject = element.getAttribute('data-subject') || '';
          if (!subject) return;
          var minutes = Number(element.value);
          if ((minutes === 60 || minutes === 45) && Number(subjectSlots[subject] || 0) > 0) subjectDurations[subject] = minutes;
        });

        updateStudentCountLocally(activeCountDialog.sessionId, activeCountDialog.studentId, subjectSlots, regularOnly, true, groupParticipation, optionChecks, subjectDurations);
        persistStudentCount(activeCountDialog.sessionId, activeCountDialog.studentId, subjectSlots, regularOnly, true, groupParticipation, optionChecks, subjectDurations);
        activeCountDialog = null;
        syncPayloadFingerprint();
        render();
      }

      function unsubmitStudentCountModal() {
        if (!activeCountDialog || !activeCountDialog.studentId || !activeCountDialog.sessionId) return;
        const currentInput = getStudentSessionInput(activeCountDialog.studentId, activeCountDialog.sessionId);
        updateStudentCountLocally(activeCountDialog.sessionId, activeCountDialog.studentId, currentInput.subjectSlots, currentInput.regularOnly, false);
        persistStudentCount(activeCountDialog.sessionId, activeCountDialog.studentId, currentInput.subjectSlots, currentInput.regularOnly, false);
        var matchedStudent = (DATA.students || []).find(function(s) { return s.id === activeCountDialog.studentId; });
        if (matchedStudent) matchedStudent.submissionSubmitted = false;
        activeCountDialog = null;
        syncPayloadFingerprint();
        render();
      }

      function submitTeacherRegisterModal() {
        if (!activeTeacherRegisterDialog || !activeTeacherRegisterDialog.teacherId || !activeTeacherRegisterDialog.sessionId) return;
        updateTeacherCountLocally(activeTeacherRegisterDialog.sessionId, activeTeacherRegisterDialog.teacherId, true);
        persistTeacherCount(activeTeacherRegisterDialog.sessionId, activeTeacherRegisterDialog.teacherId, true);
        activeTeacherRegisterDialog = null;
        syncPayloadFingerprint();
        render();
      }

      function unsubmitTeacherRegisterModal() {
        if (!activeTeacherRegisterDialog || !activeTeacherRegisterDialog.teacherId || !activeTeacherRegisterDialog.sessionId) return;
        updateTeacherCountLocally(activeTeacherRegisterDialog.sessionId, activeTeacherRegisterDialog.teacherId, false);
        persistTeacherCount(activeTeacherRegisterDialog.sessionId, activeTeacherRegisterDialog.teacherId, false);
        var matchedTeacher = (DATA.teachers || []).find(function(t) { return t.id === activeTeacherRegisterDialog.teacherId; });
        if (matchedTeacher) matchedTeacher.submissionSubmitted = false;
        activeTeacherRegisterDialog = null;
        syncPayloadFingerprint();
        render();
      }

      function getSortedPeriodBands() {
        return DATA.periodBands
          .slice()
          .sort((left, right) => left.startDate.localeCompare(right.startDate) || left.endDate.localeCompare(right.endDate) || left.label.localeCompare(right.label, 'ja'));
      }

      function buildPeriodValue(band) {
        return band.startDate + '|' + band.endDate + '|' + band.label;
      }

      function syncPeriodSelectOptions(preferredValue) {
        const previousValue = preferredValue ?? periodSelect.value;
        const options = ['<option value="">選択してください</option>'];
        const sortedBands = getSortedPeriodBands();
        sortedBands.forEach((band) => {
          const value = buildPeriodValue(band);
          options.push('<option value="' + escapeHtml(value) + '">' + escapeHtml(band.label + ' (' + formatMonthDay(band.startDate) + ' - ' + formatMonthDay(band.endDate) + ')') + '</option>');
        });
        periodSelect.innerHTML = options.join('');
        if (Array.from(periodSelect.options).some((option) => option.value === previousValue)) {
          periodSelect.value = previousValue;
          return;
        }

        const matchedBand = sortedBands.find((band) => band.startDate === startInput.value && band.endDate === endInput.value);
        periodSelect.value = matchedBand ? buildPeriodValue(matchedBand) : '';
      }

      function buildHeaderHtml(title, nameLabel, subLabel, pageIndex, periodLabel, qrHtml) {
        var qrBlock = '';
        if (qrHtml) {
          qrBlock = '<div class="meta-qr-block">' + qrHtml + '</div>';
        }
        return '<div class="sheet-top">'
          + '<div class="logo-box" data-shared-image="logo"><span class="logo-placeholder">ロゴ欄</span></div>'
          + '<div class="school-box"><textarea class="school-input shared-input" data-shared-input="school-info" rows="2" placeholder="校舎名&#10;TEL等"></textarea></div>'
          + '<div class="title-box"><input class="title-input shared-input" data-shared-input="sheet-title" value="" placeholder="授業日程表" /></div>'
          + '<div class="meta-box">' + qrBlock + '<div class="meta-info"><div class="meta-row"><span class="meta-label">期間:</span> ' + escapeHtml(periodLabel) + '</div><div class="meta-row person-meta-row"><span><span class="meta-label">' + escapeHtml(nameLabel) + ':</span> ' + escapeHtml(subLabel) + '</span></div><div class="meta-row"><span class="page-count print-only-hidden">' + (pageIndex + 1) + 'ページ目</span></div></div></div>'
          + '</div>';
      }

      function formatStudentHeaderName(student, referenceDate) {
        const gradeLabel = student.currentGradeLabel || getGradeLabel(student.birthDate, referenceDate);
        const sourceName = student.fullName || student.name;
        return gradeLabel ? sourceName + '(' + gradeLabel + ')' : sourceName;
      }

      function compareStudentOrder(left, right) {
        const orderDifference = (left.currentGradeOrder || 999) - (right.currentGradeOrder || 999);
        if (orderDifference !== 0) return orderDifference;
        const nameDifference = (left.name || '').localeCompare(right.name || '', 'ja');
        if (nameDifference !== 0) return nameDifference;
        return (left.fullName || '').localeCompare(right.fullName || '', 'ja');
      }

      function formatTeacherHeaderName(teacher) {
        return teacher.fullName || teacher.name;
      }

      function normalizeSearchText(value) {
        return String(value || '').replace(/\s+/g, '').toLowerCase();
      }

      function getVisibleStudents(startDate, endDate) {
        return DATA.students.filter((student) => isVisibleInRange(student, startDate, endDate)).sort(compareStudentOrder);
      }

      function getVisibleTeachers(startDate, endDate) {
        return DATA.teachers.filter((teacher) => isVisibleInRange(teacher, startDate, endDate)).sort((left, right) => left.name.localeCompare(right.name, 'ja'));
      }

      function getFilteredPeople(startDate, endDate) {
        const people = VIEW_TYPE === 'student' ? getVisibleStudents(startDate, endDate) : getVisibleTeachers(startDate, endDate);
        const query = normalizeSearchText(personSearchInput && 'value' in personSearchInput ? personSearchInput.value : '');
        if (!query) return people;
        return people.filter((person) => [person.name, person.fullName].some((label) => normalizeSearchText(label).includes(query)));
      }

      function getDefaultAppliedPersonId(startDate, endDate) {
        const people = VIEW_TYPE === 'student' ? getVisibleStudents(startDate, endDate) : getVisibleTeachers(startDate, endDate);
        if (!people.length) return '';
        if (appliedPersonId && people.some((person) => person.id === appliedPersonId)) return appliedPersonId;
        if (DATA.defaultPersonId && people.some((person) => person.id === DATA.defaultPersonId)) return DATA.defaultPersonId;
        if (VIEW_TYPE === 'student') {
          const highlightedStudentId = DATA.highlightedStudentSlot && typeof DATA.highlightedStudentSlot.studentId === 'string'
            ? DATA.highlightedStudentSlot.studentId
            : '';
          if (highlightedStudentId && people.some((person) => person.id === highlightedStudentId)) return highlightedStudentId;
          const firstScheduledStudentId = findFirstVisibleStudentWithSchedule(startDate, endDate, people);
          if (firstScheduledStudentId) return firstScheduledStudentId;
        } else {
          const firstScheduledTeacherId = findFirstVisibleTeacherWithSchedule(startDate, endDate, people);
          if (firstScheduledTeacherId) return firstScheduledTeacherId;
        }
        return people[0].id;
      }

      function syncPersonSelectOptions(preferredPersonId) {
        const draftStartDate = startInput.value || DATA.defaultStartDate || DATA.availableStartDate;
        const draftEndDate = endInput.value || DATA.defaultEndDate || DATA.availableEndDate;
        const normalizedStartDate = draftStartDate <= draftEndDate ? draftStartDate : draftEndDate;
        const normalizedEndDate = draftStartDate <= draftEndDate ? draftEndDate : draftStartDate;
        const people = getFilteredPeople(normalizedStartDate, normalizedEndDate);
        const currentValue = preferredPersonId ?? personSelect.value;

        if (!people.length) {
          personSelect.innerHTML = '<option value="">該当なし</option>';
          personSelect.value = '';
          applyButton.disabled = true;
          return '';
        }

        personSelect.innerHTML = people.map((person) => {
          const label = VIEW_TYPE === 'student'
            ? formatStudentHeaderName(person, normalizedStartDate)
            : formatTeacherHeaderName(person);
          return '<option value="' + escapeHtml(person.id) + '">' + escapeHtml(label) + '</option>';
        }).join('');
        const nextValue = people.some((person) => person.id === currentValue) ? currentValue : people[0].id;
        personSelect.value = nextValue;
        applyButton.disabled = false;
        return nextValue;
      }

      function buildStudentCountAdjustmentMap(student, startDate, endDate, countKind) {
        const countMap = {};
        (DATA.countAdjustments || []).forEach((entry) => {
          if (!entry || entry.countKind !== countKind) return;
          const matchesStudent = entry.studentKey === student.id || entry.studentKey === student.name || entry.studentKey === student.fullName;
          if (!matchesStudent) return;
          if (entry.dateKey < startDate || entry.dateKey > endDate) return;
          const normalizedSubject = normalizeSubjectForStudent(entry.subject, student, startDate);
          const delta = Number.isFinite(Number(entry.delta)) ? Math.trunc(Number(entry.delta)) : 0;
          if (!normalizedSubject || delta === 0) return;
          countMap[normalizedSubject] = (countMap[normalizedSubject] || 0) + delta;
        });
        return countMap;
      }

      function applyCountAdjustments(countMap, adjustmentMap) {
        const next = { ...(countMap || {}) };
        Object.entries(adjustmentMap || {}).forEach(([subject, rawDelta]) => {
          const delta = Number.isFinite(Number(rawDelta)) ? Math.trunc(Number(rawDelta)) : 0;
          if (delta === 0) return;
          const nextValue = (next[subject] || 0) + delta;
          if (nextValue > 0) next[subject] = nextValue;
          else delete next[subject];
        });
        return next;
      }

      function buildStudentSheetHtml(startDate, endDate, studentId, indexOverride, emptyFormat) {
        const filteredCells = filterCells(startDate, endDate);
        const dateHeaders = buildDateHeaders(startDate, endDate);
        const slotNumbers = getSlotNumbers();
        const cellMap = buildCellMap(filteredCells);
        const assignmentMap = buildStudentAssignments(filteredCells);
        const periodSegments = buildPeriodSegments(dateHeaders);
        const cornerYearHtml = makeCornerYearHtml(dateHeaders);
        const monthHeaderHtml = makeMonthHeaderHtml(dateHeaders);
        const weekdayHeaderHtml = makeWeekdayHeaderHtml(dateHeaders);
        const tableDensityClass = getTableDensityClass(dateHeaders);
        const students = getVisibleStudents(startDate, endDate);
        const student = students.find((entry) => entry.id === studentId) || students[0] || null;
        if (!student) return { html: null, student: null };
        const showQr = emptyFormat ? false : shouldShowScheduleQr();
        const studentIndex = typeof indexOverride === 'number' ? indexOverride : Math.max(0, students.findIndex((entry) => entry.id === student.id));
        const entries = getStudentAssignmentKeys(student).flatMap((key) => assignmentMap.get(key) || []);
        const keyMap = groupScheduleEntriesBySlot(entries);
        const unavailableSlots = getUnavailableSlotsForStudent(student.id);
        const subjectCounts = {};
        const plannedRegularCounts = {};
        const lectureCounts = {};
        // 講習回数表の科目に授業時間(60/45分)を併記するため、正規化済み科目ごとに実配置コマの分数を収集。
        const lectureMinutesBySubjectList = {};
        const desiredLectureCounts = buildDesiredLectureCountMap(student, startDate, endDate);
        const regularCountAdjustments = buildStudentCountAdjustmentMap(student, startDate, endDate, 'regular');
        const lectureCountAdjustments = buildStudentCountAdjustmentMap(student, startDate, endDate, 'special');
        const absenceNotes = collectStudentAbsenceNotes(filteredCells, student);
        const makeupNotes = collectStudentMakeupNotes(entries);
        entries.forEach((entry) => {
          if (entry.lesson.status === 'absent') return;
          if (entry.lesson.lessonType === 'special') {
            lectureCounts[entry.lesson.subject] = (lectureCounts[entry.lesson.subject] || 0) + 1;
            const normalizedSubject = normalizeSubjectForStudent(entry.lesson.subject, student, startDate);
            if (!lectureMinutesBySubjectList[normalizedSubject]) lectureMinutesBySubjectList[normalizedSubject] = [];
            lectureMinutesBySubjectList[normalizedSubject].push(formatScheduleMinutesSuffix(entry.lesson.noteSuffix));
          }
          else subjectCounts[entry.lesson.subject] = (subjectCounts[entry.lesson.subject] || 0) + 1;
        });
        // 科目の授業時間(60/45分)併記。実配置コマの分数を優先し、未配置(希望登録のみ)の科目は
        // 希望登録(subjectDurations)の分数でフォールバックする。いずれも科目内で一意のときだけ付ける。
        const desiredLectureMinutes = buildDesiredLectureMinutesMap(student, startDate, endDate);
        const lectureMinutesBySubject = resolveLectureMinutesBySubject(lectureMinutesBySubjectList, desiredLectureMinutes);
        (Array.isArray(DATA.expectedRegularOccurrences) ? DATA.expectedRegularOccurrences : []).forEach((entry) => {
          if (entry.linkedStudentId !== student.id) return;
          if (entry.dateKey < startDate || entry.dateKey > endDate) return;
          plannedRegularCounts[entry.subject] = (plannedRegularCounts[entry.subject] || 0) + 1;
        });
        const visibleRegularCounts = normalizeCountMapSubjects(subjectCounts, student, startDate);
        const visiblePlannedRegularCounts = applyCountAdjustments(normalizeCountMapSubjects(plannedRegularCounts, student, startDate), regularCountAdjustments);
        const visibleLectureCounts = normalizeCountMapSubjects(lectureCounts, student, startDate);
        const visibleDesiredLectureCounts = applyCountAdjustments(normalizeCountMapSubjects(desiredLectureCounts, student, startDate), lectureCountAdjustments);
        // spec-group-lesson §D: 中3参加者のみ 集理/集社 を講習回数表に注入(表示期間内・希望=コマ数/実績=出席数)。
        injectGroupClassCounts(student, startDate, endDate, visibleLectureCounts, visibleDesiredLectureCounts);
        const regularCountWarningHtml = hasCountMismatch(visibleRegularCounts, visiblePlannedRegularCounts)
          ? '<div class="count-warning-stamp print-only-hidden" data-testid="student-schedule-regular-count-warning">希望数と予定数が一致していません！</div>'
          : '';
        const lectureCountWarningHtml = hasCountMismatch(visibleLectureCounts, visibleDesiredLectureCounts)
          ? '<div class="count-warning-stamp print-only-hidden" data-testid="student-schedule-lecture-count-warning">希望数と予定数が一致していません！</div>'
          : '';
        const rows = slotNumbers.map((slotNumber) => {
          const timeLabel = filteredCells.find((cell) => cell.slotNumber === slotNumber)?.timeLabel || slotNumber + '限';
          const cellsHtml = dateHeaders.map((dateHeader) => {
            const cell = cellMap.get(dateHeader.dateKey + '_' + slotNumber);
            const slotKey = dateHeader.dateKey + '_' + slotNumber;
            if (emptyFormat) {
              const emptyClasses = ['slot-cell'];
              if (!dateHeader.isOpenDay || (cell && !cell.isOpenDay)) emptyClasses.push('is-holiday');
              return '<td class="' + emptyClasses.join(' ') + '"><div class="slot-cell-content"><div class="slot-static"></div></div></td>';
            }
            const assignments = keyMap.get(dateHeader.dateKey + '_' + slotNumber) || [];
            const isEditable = getEditableSpecialSessionsForStudent(student.id, dateHeader.dateKey).length > 0 && dateHeader.isOpenDay && (!cell || cell.isOpenDay);
            const classes = ['slot-cell'];
            if (!dateHeader.isOpenDay || (cell && !cell.isOpenDay)) classes.push('is-holiday');
            if (isEditable) classes.push('is-editable');
            if (unavailableSlots.has(slotKey)) classes.push('is-unavailable');
            const highlightedStudentSlot = DATA.highlightedStudentSlot;
            const isHighlightedStudent = highlightedStudentSlot && (
              highlightedStudentSlot.studentId === student.id
              || highlightedStudentSlot.studentName === student.fullName
              || highlightedStudentSlot.studentName === student.name
              || highlightedStudentSlot.studentDisplayName === student.name
            );
            if (isHighlightedStudent && highlightedStudentSlot.dateKey === dateHeader.dateKey && highlightedStudentSlot.slotNumber === slotNumber) {
              classes.push('is-moving-highlight');
            }
            const content = renderStudentCellCards(assignments);
            const title = assignments.length ? assignments.map((assignment) => [assignment.lesson.subject, lessonTypeLabels[assignment.lesson.lessonType] || assignment.lesson.lessonType, assignment.teacher].filter(Boolean).join(' / ')).join(' | ') : '';
            return '<td class="' + classes.join(' ') + '" data-role="student-slot-cell" data-student-id="' + student.id + '" data-date-key="' + dateHeader.dateKey + '" data-slot-number="' + slotNumber + '" data-slot-key="' + slotKey + '" data-pending-unavailable-key="' + buildUnavailablePendingKey('student', student.id, 'cell', slotKey) + '" data-editable="' + (isEditable ? 'true' : 'false') + '" data-testid="student-schedule-cell-' + student.id + '-' + slotKey + '"><div class="slot-cell-content">' + renderStudentSlotContent(student.id, slotKey, content, title, !isEditable) + '</div></td>';
          }).join('');
          const timeHeaderCell = emptyFormat ? renderTimeHeaderCell(timeLabel, slotNumber) : renderStudentTimeHeaderCell(student.id, timeLabel, slotNumber, dateHeaders, cellMap);
          return '<tr>' + timeHeaderCell + cellsHtml + '</tr>';
        }).join('');
        const absenceRows = emptyFormat ? toMakeupRows([], 7) : toMakeupRows(absenceNotes, 7);
        const makeupRows = emptyFormat ? toMakeupRows([], 7) : toMakeupRows(makeupNotes, 7);
        const periodRowHtml = periodSegments.length ? '<tr class="period-row"><th class="time-col"></th>' + periodSegments.map((segment) => emptyFormat ? renderStaticPeriodBandCell(segment) : renderStudentPeriodBandCell(student.id, segment)).join('') + '</tr>' : '';
        const qrHtml = buildScheduleQrHtml(student, showQr);
        const dateHeaderHtml = dateHeaders.map((header) => emptyFormat ? renderStaticDateHeaderCell(header) : renderStudentDateHeaderCell(student.id, header, slotNumbers, cellMap)).join('');
        var gradeCommonKey = 'student-common-grade-' + (student.currentGradeLabel || '未設定');
        var headerNameLabel = emptyFormat ? '' : formatStudentHeaderName(student, startDate);
        var allSubjectsForCounts = getVisibleSubjectsForStudent(student, startDate);
        var emptyFormatSubjects = ['英', '算/数', '国', '理', '社'];
        // spec-group-lesson §E: 空フォーマットは中3想定。期間内に集団コマがあれば講習回数に 集理/集社 を追加する。
        var emptyFormatHasGroup = getGroupClassEntriesInRange(startDate, endDate).length > 0;
        var emptyFormatLectureSubjects = (emptyFormat && emptyFormatHasGroup) ? emptyFormatSubjects.concat(['集理', '集社']) : emptyFormatSubjects;
        var regularCountRows = emptyFormat ? toEmptyCountRows(emptyFormatSubjects) : toCountRows(visibleRegularCounts, visiblePlannedRegularCounts);
        var lectureCountRows = emptyFormat ? toEmptyCountRows(emptyFormatLectureSubjects) : toCountRows(visibleLectureCounts, visibleDesiredLectureCounts, allSubjectsForCounts, {hideZeroZero: true, labelMinutesMap: lectureMinutesBySubject});
        var bottomSectionHtml = renderBottomSection(gradeCommonKey, 'student-' + student.id, absenceRows, makeupRows, regularCountRows, lectureCountRows, emptyFormat ? '' : regularCountWarningHtml, emptyFormat ? '' : lectureCountWarningHtml, { absenceTestId: 'student-schedule-absence-table-' + student.id, emptyFormat: emptyFormat, optionGradeLabel: (student.currentGradeLabel || '未設定'), optionChecks: (emptyFormat ? undefined : student.optionChecks) });
        // spec-group-lesson §E: 中3は1限の上に集団行(2バンド)を差し込む。空フォーマットは中3想定で盤面の集団コマを反映する。
        var groupRowsHtml = emptyFormat ? buildEmptyFormatGroupRowsHtml(startDate, endDate, dateHeaders) : buildStudentGroupRowsHtml(student, startDate, endDate, dateHeaders);
        var html = '<section class="sheet" data-role="student-sheet" data-student-id="' + student.id + '">' + buildHeaderHtml('授業日程表', '生徒名', headerNameLabel, studentIndex, formatRangeLabel(startDate, endDate), qrHtml) + '<table class="schedule-table ' + tableDensityClass + '"><thead>' + periodRowHtml + '<tr class="month-row"><th class="time-col time-corner" rowspan="3"><div class="time-corner-box">' + cornerYearHtml + '</div></th>' + monthHeaderHtml + '</tr><tr class="date-row">' + dateHeaderHtml + '</tr><tr class="weekday-row">' + weekdayHeaderHtml + '</tr></thead><tbody>' + groupRowsHtml + rows + '</tbody></table>' + bottomSectionHtml + '</section>';
        return { html: html, student: student };
      }

      function renderStudentPages(startDate, endDate, studentId) {
        const result = buildStudentSheetHtml(startDate, endDate, studentId);
        if (!result.html) {
          pagesElement.innerHTML = '<div class="empty-state">表示できる生徒が見つかりません。</div>';
          return null;
        }
        pagesElement.innerHTML = result.html;
        // 移動成立コマの黄色ハイライトを再描画のたびに適用し直す(自動同期をまたいで数秒持続させる)。
        if (typeof applyScheduleMoveHighlight === 'function') applyScheduleMoveHighlight();
        return result.student;
      }

      function readSharedValueForEmptyFormat(sharedKey) {
        const storage = getSharedStorage();
        try {
          return storage ? (storage.getItem(getSharedInputStorageKey(sharedKey)) || '') : '';
        } catch (error) {
          return '';
        }
      }

      function readStoredLogoForEmptyFormat() {
        const storage = getSharedStorage();
        try {
          return storage ? (storage.getItem(sharedGlobalStoragePrefix + 'logo') || '') : '';
        } catch (error) {
          return '';
        }
      }

      function renderStaticPeriodBandCell(segment) {
        if (segment.type === 'gap') return '<th class="period-gap" colspan="' + segment.colSpan + '"></th>';
        return '<th class="period-band" colspan="' + segment.colSpan + '"><span class="period-pill">' + renderPeriodPill(segment) + '</span></th>';
      }

      function renderStaticDateHeaderCell(dateHeader) {
        const headerClass = !dateHeader.isOpenDay ? 'holiday-col' : '';
        return '<th class="' + headerClass + '"><span class="date-label">' + Number(dateHeader.dateKey.split('-')[2]) + '</span></th>';
      }

      function toEmptyCountRows(subjects) {
        if (!subjects || !subjects.length) return '<tr><td></td><td></td></tr>';
        return subjects.map((label) => '<tr><td>' + escapeHtml(label) + '</td><td></td></tr>').join('');
      }

      function applyEmptyFormatBranding(sheetHtml) {
        var nextHtml = sheetHtml;
        var schoolValue = readSharedValueForEmptyFormat('school-info');
        var titleValue = readSharedValueForEmptyFormat('sheet-title') || '授業日程表';
        var logoValue = readStoredLogoForEmptyFormat();
        var schoolAnchor = ' data-shared-input="school-info" rows="2" placeholder="校舎名&#10;TEL等"></textarea>';
        var schoolReplacement = ' data-shared-input="school-info" rows="2" placeholder="校舎名&#10;TEL等">' + escapeHtml(schoolValue) + '</textarea>';
        nextHtml = nextHtml.replace(schoolAnchor, schoolReplacement);
        var titleAnchor = 'data-shared-input="sheet-title" value=""';
        var titleReplacement = 'data-shared-input="sheet-title" value="' + escapeHtml(titleValue) + '"';
        nextHtml = nextHtml.replace(titleAnchor, titleReplacement);
        if (logoValue) {
          var logoAnchor = '<span class="logo-placeholder">ロゴ欄</span>';
          var logoReplacement = '<img class="logo-image" src="' + logoValue + '" alt="logo" />';
          nextHtml = nextHtml.replace(logoAnchor, logoReplacement);
        }
        return nextHtml;
      }

      // 空フォーマット専用の入力保持スクリプト。data-empty-format-field を持つ入力を
      // 空フォーマット専用ストレージ(storagePrefix + フィールド名)へ読み書きする(実データ scheduleNotes とは別枠)。
      // opener(元の日程表ウィンドウ)の localStorage を優先し、開き直しても保持する。
      // (scheduleHtml.test.ts が new Function で抽出して構文と往復を固定する)
      function buildEmptyFormatEditorScript(storagePrefix) {
        return '<scr' + 'ipt>(function(){'
          + 'var store=null;'
          + 'try{store=(window.opener&&window.opener.localStorage)?window.opener.localStorage:window.localStorage;}catch(e){try{store=window.localStorage;}catch(e2){store=null;}}'
          + 'var PREFIX=' + JSON.stringify(storagePrefix) + ';'
          + 'var fields=document.querySelectorAll("[data-empty-format-field]");'
          + 'Array.prototype.forEach.call(fields,function(el){'
          + 'var name=el.getAttribute("data-empty-format-field");'
          + 'var key=PREFIX+name;'
          + 'try{var saved=store?store.getItem(key):null;if(saved!==null&&saved!==undefined)el.value=saved;}catch(e){}'
          + 'el.addEventListener("input",function(){try{if(store)store.setItem(key,el.value);}catch(e){}});'
          + '});'
          + '})();</scr' + 'ipt>';
      }

      function openEmptyFormatPrintWindow() {
        var startDate = (startInput && startInput.value) || appliedStartDate || DATA.defaultStartDate || DATA.availableStartDate;
        var endDate = (endInput && endInput.value) || appliedEndDate || DATA.defaultEndDate || DATA.availableEndDate;
        if (startDate > endDate) {
          var previous = startDate;
          startDate = endDate;
          endDate = previous;
        }
        var result = buildStudentSheetHtml(startDate, endDate, appliedPersonId, 0, true);
        if (!result.html) {
          window.alert('空フォーマットを作成できる生徒が見つかりません。');
          return;
        }
        var sheetHtml = applyEmptyFormatBranding(result.html);
        var styleHtml = Array.from(document.querySelectorAll('style')).map((element) => element.outerHTML).join('');
        var printWindow = window.open('', 'schedule-empty-format-' + Date.now());
        if (!printWindow) return;
        // オーナー指示(2026-07-11): 空フォーマットは「編集してから印刷」。自動印刷せず、入力・保持のうえで印刷ボタンを押す。
        var toolbarHtml = '<div class="empty-format-toolbar print-only-hidden" style="margin:0 0 12px;">'
          + '<button type="button" onclick="window.print()" style="padding:8px 16px;font-size:14px;cursor:pointer;">印刷</button>'
          + '<span style="margin-left:12px;color:#52606d;font-size:12px;">連絡事項・オプションは入力すると自動保存されます。</span>'
          + '</div>';
        var editorScript = buildEmptyFormatEditorScript(sharedGlobalStoragePrefix + 'empty-format:');
        // body.all-view .sheet は pointer-events:none(一覧は非操作)。空フォーマットの連絡事項/オプション欄だけ
        // クリック・入力できるよう pointer-events を再有効化する(継承 none を子要素側で auto へ上書き)。これが無いと入力モードに入れない。
        var editableStyle = '<style>[data-empty-format-field]{pointer-events:auto;}</style>';
        printWindow.document.open();
        printWindow.document.write('<!doctype html><html lang="ja"><head><meta charset="UTF-8" /><title>空フォーマット印刷</title>' + styleHtml + editableStyle + '</head><body class="all-view">' + toolbarHtml + sheetHtml + editorScript + '</body></html>');
        printWindow.document.close();
      }

      function buildTeacherSheetHtml(startDate, endDate, teacherId, indexOverride) {
        const filteredCells = filterCells(startDate, endDate);
        const dateHeaders = buildDateHeaders(startDate, endDate);
        const slotNumbers = getSlotNumbers();
        const cellMap = buildCellMap(filteredCells);
        const assignmentMap = buildTeacherAssignments(filteredCells);
        const periodSegments = buildPeriodSegments(dateHeaders);
        const cornerYearHtml = makeCornerYearHtml(dateHeaders);
        const monthHeaderHtml = makeMonthHeaderHtml(dateHeaders);
        const weekdayHeaderHtml = makeWeekdayHeaderHtml(dateHeaders);
        const tableDensityClass = getTableDensityClass(dateHeaders);
        const teachers = getVisibleTeachers(startDate, endDate);
        const teacher = teachers.find((entry) => entry.id === teacherId) || teachers[0] || null;
        if (!teacher) return { html: null, teacher: null };
        const showQr = shouldShowScheduleQr();
        const teacherIndex = typeof indexOverride === 'number' ? indexOverride : Math.max(0, teachers.findIndex((entry) => entry.id === teacher.id));
        const entries = collectTeacherAssignmentEntries(assignmentMap, teacher);
        const keyMap = groupScheduleEntriesBySlot(entries);
        const unavailableSlots = getUnavailableSlotsForTeacher(teacher.id);
        const regularCounts = {};
        const lectureCounts = {};
        const makeupNotes = collectTeacherMakeupNotes(entries);
        entries.forEach((entry) => {
          entry.students.forEach((student) => {
            if (student.lessonType === 'special') lectureCounts[student.subject] = (lectureCounts[student.subject] || 0) + 1;
            else regularCounts[student.subject] = (regularCounts[student.subject] || 0) + 1;
          });
          (entry.statuses || []).forEach((student) => {
            if (student.status === 'absent') return;
            if (student.lessonType === 'special') lectureCounts[student.subject] = (lectureCounts[student.subject] || 0) + 1;
            else regularCounts[student.subject] = (regularCounts[student.subject] || 0) + 1;
          });
        });
        const rows = slotNumbers.map((slotNumber) => {
          const timeLabel = filteredCells.find((cell) => cell.slotNumber === slotNumber)?.timeLabel || slotNumber + '限';
          const cellsHtml = dateHeaders.map((dateHeader) => {
            const cell = cellMap.get(dateHeader.dateKey + '_' + slotNumber);
            const slotEntries = keyMap.get(dateHeader.dateKey + '_' + slotNumber) || [];
            const slotKey = dateHeader.dateKey + '_' + slotNumber;
            const isEditable = getEditableSpecialSessionsForTeacher(teacher.id, dateHeader.dateKey).length > 0 && dateHeader.isOpenDay && (!cell || cell.isOpenDay);
            const classes = ['slot-cell'];
            if (!dateHeader.isOpenDay || (cell && !cell.isOpenDay)) classes.push('is-holiday');
            if (isEditable) classes.push('is-editable');
            if (unavailableSlots.has(slotKey)) classes.push('is-unavailable');
            const slotStudents = slotEntries.flatMap((entry) => entry.students || []);
            const slotStatuses = slotEntries.flatMap((entry) => entry.statuses || []);
            // Part1: 休みに別生徒が重なって溢れたコマは、溢れた休み生徒を机(entry)単位で間引く。
            const visibleStatuses = slotEntries.flatMap((entry) => selectVisibleTeacherCellStatuses(entry.students || [], entry.statuses || []));
            let content = '<div class="empty-label"></div>';
            if (slotStudents.length > 0 || visibleStatuses.length > 0) content = renderTeacherCellCard(slotStudents, visibleStatuses);
            const title = slotEntries.length ? [...slotStudents, ...slotStatuses].map((student) => formatTeacherTooltipEntry(student)).join(' | ') : '';
            return '<td class="' + classes.join(' ') + '" data-role="teacher-slot-cell" data-teacher-id="' + teacher.id + '" data-date-key="' + dateHeader.dateKey + '" data-slot-number="' + slotNumber + '" data-slot-key="' + slotKey + '" data-pending-unavailable-key="' + buildUnavailablePendingKey('teacher', teacher.id, 'cell', slotKey) + '" data-editable="' + (isEditable ? 'true' : 'false') + '" data-testid="teacher-schedule-cell-' + teacher.id + '-' + slotKey + '"><div class="slot-cell-content">' + renderTeacherSlotContent(teacher.id, slotKey, content, title, !isEditable) + '</div></td>';
          }).join('');
          return '<tr>' + renderTeacherTimeHeaderCell(teacher.id, timeLabel, slotNumber, dateHeaders, cellMap) + cellsHtml + '</tr>';
        }).join('');
        const makeupRows = toMakeupRows(makeupNotes, 7);
        const salaryData = buildTeacherSalaryData(entries, teacher, startDate, endDate);
        // spec-group-lesson §F: 講師の集団行(担当する集団コマ)を1限の上へ差し込む。
        var groupRowsHtml = buildTeacherGroupRowsHtml(teacher, startDate, endDate, dateHeaders);
        const periodRowHtml = periodSegments.length ? '<tr class="period-row"><th class="time-col"></th>' + periodSegments.map((segment) => renderTeacherPeriodBandCell(teacher.id, segment)).join('') + '</tr>' : '';
        const qrHtml = buildScheduleQrHtml(teacher, showQr);
        const teacherDateHeaderHtml = dateHeaders.map((header) => renderTeacherDateHeaderCell(teacher.id, header, slotNumbers, cellMap)).join('');
        var html = '<section class="sheet" data-role="teacher-sheet" data-teacher-id="' + teacher.id + '">' + buildHeaderHtml('授業日程表', '講師名', formatTeacherHeaderName(teacher), teacherIndex, formatRangeLabel(startDate, endDate), qrHtml) + '<table class="schedule-table ' + tableDensityClass + '"><thead>' + periodRowHtml + '<tr class="month-row"><th class="time-col time-corner" rowspan="3"><div class="time-corner-box">' + cornerYearHtml + '</div></th>' + monthHeaderHtml + '</tr><tr class="date-row">' + teacherDateHeaderHtml + '</tr><tr class="weekday-row">' + weekdayHeaderHtml + '</tr></thead><tbody>' + groupRowsHtml + rows + '</tbody></table>' + renderBottomSection('teacher-common', 'teacher-' + teacher.id, '', makeupRows, toCountRows(regularCounts), toCountRows(lectureCounts), '', '', { isTeacher: true, salaryData: salaryData }) + '</section>';
        return { html: html, teacher: teacher };
      }

      // 講師ページが A4 横(297×210)に収まらないとき A3 縦へ切替えるべきか判定する純粋関数。
      // salaryHidden = 給与スクロール枠に隠れている行の高さ(px)、
      // sheetOverflow = シート本体(.sheet は overflow:hidden + A4横のアスペクト比固定)から
      //                 はみ出して下が見切れている高さ(px)。どちらかが有意に超えたら A3 にする。
      // 計測ベースなので「行/コマが増えすぎて見切れる場合だけ」自動でA3になる(通常はA4横のまま)。
      function shouldTeacherSheetUseA3(salaryHidden, sheetOverflow) {
        return salaryHidden > 2 || sheetOverflow > 4;
      }

      // 週グリッドや給与計算が用紙(印刷で見切れる範囲)に収まらない講師ページを A3 縦へ切替える。
      // Part3 で給与は横2列になり縦に伸びにくくなった(スクロール枠は廃止)。よって salaryHidden は
      // 常に0で渡し、シート本体のはみ出し量だけで判定する(極端に行が多い講師の安全網は維持)。
      function applySalaryOverflowPaging() {
        if (!pagesElement) return;
        var sheets = pagesElement.querySelectorAll('.sheet[data-role="teacher-sheet"]');
        for (var i = 0; i < sheets.length; i++) {
          var sheet = sheets[i];
          sheet.classList.remove('is-a3-portrait');
          // シート本体からはみ出して下が見切れている高さ(週グリッド/給与が縦に長い講師ページ)。
          var sheetOverflow = sheet.scrollHeight - sheet.clientHeight;
          if (shouldTeacherSheetUseA3(0, sheetOverflow)) {
            sheet.classList.add('is-a3-portrait');
          }
        }
      }

      function renderTeacherPages(startDate, endDate, teacherId) {
        const result = buildTeacherSheetHtml(startDate, endDate, teacherId);
        if (!result.html) {
          pagesElement.innerHTML = '<div class="empty-state">表示できる講師が見つかりません。</div>';
          return null;
        }
        pagesElement.innerHTML = result.html;
        applySalaryOverflowPaging();
        return result.teacher;
      }

      function renderAllPages(startDate, endDate) {
        var allHtml = '';
        if (VIEW_TYPE === 'all-student' || VIEW_TYPE === 'all') {
          var students = getVisibleStudents(startDate, endDate);
          students.forEach(function(student, idx) {
            var result = buildStudentSheetHtml(startDate, endDate, student.id, idx);
            if (result.html) allHtml += result.html;
          });
        }
        if (VIEW_TYPE === 'all-teacher' || VIEW_TYPE === 'all') {
          var teachers = getVisibleTeachers(startDate, endDate);
          teachers.forEach(function(teacher, idx) {
            var result = buildTeacherSheetHtml(startDate, endDate, teacher.id, idx);
            if (result.html) allHtml += result.html;
          });
        }
        if (!allHtml) {
          pagesElement.innerHTML = '<div class="empty-state">表示できるデータが見つかりません。</div>';
          return;
        }
        pagesElement.innerHTML = allHtml;
        applySalaryOverflowPaging();
      }

      function applyIncomingPayload(nextPayload) {
        mergeCachedQrSvg(nextPayload);
        const nextFingerprint = buildPayloadFingerprint(nextPayload);
        const draftStartDate = startInput.value;
        const draftEndDate = endInput.value;
        const draftPeriodValue = periodSelect.value;
        const draftPersonId = personSelect.value;

        if (nextFingerprint === payloadFingerprint) {
          DATA = nextPayload;
          syncScheduleNoteInputs();
          return;
        }

        // Auto-switch until the user explicitly applies a person selection.
        var highlightPersonId = nextPayload.highlightedStudentSlot && nextPayload.highlightedStudentSlot.studentId;
        if (VIEW_TYPE === 'student' && !personSelectionLocked && highlightPersonId) {
          appliedPersonId = highlightPersonId;
        }
        var highlightedTeacherId = typeof nextPayload.highlightedTeacherId === 'string' ? nextPayload.highlightedTeacherId : '';
        if (VIEW_TYPE === 'teacher' && !personSelectionLocked && highlightedTeacherId) {
          appliedPersonId = highlightedTeacherId;
        }

        if (skipNextEquivalentPayload && nextFingerprint === payloadFingerprint) {
          DATA = nextPayload;
          payloadFingerprint = nextFingerprint;
          skipNextEquivalentPayload = false;
          syncPeriodSelectOptions(draftPeriodValue || appliedPeriodValue);
          if (draftStartDate) setDateInputValue(startInput, draftStartDate);
          if (draftEndDate) setDateInputValue(endInput, draftEndDate);
          syncPersonSelectOptions(appliedPersonId);
          if (appliedStartDate && appliedEndDate && isDateWithinAvailableRange(appliedStartDate) && isDateWithinAvailableRange(appliedEndDate)) {
            render();
            return;
          }
          const preferredRange = getPreferredRange();
          setRangeAndRender(
            preferredRange.startDate,
            preferredRange.endDate,
            preferredRange.periodValue,
            appliedPersonId || getDefaultAppliedPersonId(preferredRange.startDate, preferredRange.endDate),
          );
          return;
        }

        skipNextEquivalentPayload = false;
        DATA = nextPayload;
        payloadFingerprint = nextFingerprint;
        syncPeriodSelectOptions(draftPeriodValue || appliedPeriodValue);
        if (draftStartDate) setDateInputValue(startInput, draftStartDate);
        if (draftEndDate) setDateInputValue(endInput, draftEndDate);
        syncPersonSelectOptions(appliedPersonId);
        if (appliedStartDate && appliedEndDate && isDateWithinAvailableRange(appliedStartDate) && isDateWithinAvailableRange(appliedEndDate)) {
          render();
          return;
        }
        const preferredRange = getPreferredRange();
        setRangeAndRender(
          preferredRange.startDate,
          preferredRange.endDate,
          preferredRange.periodValue,
          appliedPersonId || getDefaultAppliedPersonId(preferredRange.startDate, preferredRange.endDate),
        );
      }

      function flushIncomingPayload() {
        incomingPayloadJobId = 0;
        // 自動同期の再描画は pagesElement.innerHTML を差し替えるため、進行中のドラッグ/机選択モーダルは破棄する
        // (再描画で参照先の DOM が消えて宙に浮くのを防ぐ)。
        cancelScheduleDndInteraction();
        const nextPayload = pendingIncomingPayload;
        pendingIncomingPayload = null;
        if (nextPayload) applyIncomingPayload(nextPayload);
        // 反映が終わったら(等価ペイロードで再描画なしでも)同期中スピナーを必ず消す。
        hideScheduleSyncingOverlay();
        // スピナーが消えた後に、保留中の移動成立ハイライトがあれば開始する。
        promotePendingScheduleMoveHighlight();
      }

      function scheduleIncomingPayload(nextPayload) {
        pendingIncomingPayload = nextPayload;
        if (incomingPayloadJobId) return;
        if (typeof window.requestAnimationFrame === 'function') {
          incomingPayloadJobId = window.requestAnimationFrame(flushIncomingPayload);
          return;
        }
        incomingPayloadJobId = window.setTimeout(flushIncomingPayload, 0);
      }

      window.__scheduleViewType = VIEW_TYPE;
      window.__applySchedulePayload = scheduleIncomingPayload;
      if (window.__pendingSchedulePayload && window.__pendingSchedulePayload.viewType === VIEW_TYPE && window.__pendingSchedulePayload.payload) {
        scheduleIncomingPayload(window.__pendingSchedulePayload.payload);
        window.__pendingSchedulePayload = null;
      }

      function postScheduleNoteUpdate(noteKey, value) {
        try {
          if (!window.opener || window.opener.closed) return;
          window.opener.postMessage({
            type: 'schedule-note-update',
            viewType: BASE_VIEW_TYPE,
            noteKey: noteKey,
            noteId: getScheduleNoteId(noteKey),
            value: String(value || ''),
          }, '*');
        } catch {}
      }

      function notifyScheduleNoteChange(noteKey, value) {
        setScheduleNoteValue(noteKey, value);
        postScheduleNoteUpdate(noteKey, value);
      }

      function updateScheduleNoteDraft(noteKey, value) {
        setScheduleNoteValue(noteKey, value);
      }

      function bindNotes() {
        document.querySelectorAll('.memo-input').forEach((element) => {
          const noteKey = element.getAttribute('data-note-key');
          const savedFromPayload = getScheduleNoteValue(noteKey);
          const key = 'schedule-note:' + STORAGE_SCOPE + ':' + BASE_VIEW_TYPE + ':' + noteKey;
          const storage = getSharedStorage();
          try {
            const savedFromStorage = storage ? storage.getItem(key) : null;
            if (savedFromPayload) {
              storage && storage.setItem(key, savedFromPayload);
            } else if (savedFromStorage !== null && !element.value) {
              element.value = savedFromStorage;
              notifyScheduleNoteChange(noteKey, savedFromStorage);
            }
          } catch {}
          element.addEventListener('input', () => {
            const nextValue = element.value;
            updateScheduleNoteDraft(noteKey, nextValue);
            try { storage && storage.setItem(key, nextValue); } catch {}
            document.querySelectorAll('.memo-input[data-note-key="' + noteKey + '"]').forEach((other) => {
              if (other !== element) other.value = nextValue;
            });
          });
          element.addEventListener('change', () => notifyScheduleNoteChange(noteKey, element.value));
          element.addEventListener('blur', () => notifyScheduleNoteChange(noteKey, element.value));
        });
      }

      function bindSalaryInputs() {
        document.querySelectorAll('.salary-input[data-salary-key]').forEach(function(element) {
          var salaryKey = element.getAttribute('data-salary-key');
          var key = 'schedule-salary:' + STORAGE_SCOPE + ':' + BASE_VIEW_TYPE + ':' + salaryKey;
          var storage = getSharedStorage();
          try {
            var saved = storage ? storage.getItem(key) : null;
            if (saved !== null && !element.value) element.value = saved;
          } catch(e) {}
          recalcSalary(element);
          element.addEventListener('input', function() {
            try { storage && storage.setItem(key, element.value); } catch(e) {}
            recalcSalary(element);
          });
        });
      }

      function recalcSalary(changedElement) {
        var section = changedElement.closest('.salary-section');
        if (!section) return;
        var grand = 0;
        section.querySelectorAll('.salary-input[data-salary-key]').forEach(function(inp) {
          var row = inp.closest('tr');
          if (!row) return;
          var subtotalCell = row.querySelector('.salary-subtotal');
          if (!subtotalCell) return;
          var unitPrice = parseInt(inp.value, 10) || 0;
          var subtotal;
          if (inp.getAttribute('data-salary-fixed') === '1') {
            // 事務給: コマ数を考慮せず単価そのものを小計に
            subtotal = unitPrice;
          } else {
            var countCell = row.querySelector('.salary-count');
            if (!countCell) return;
            var count = parseInt(countCell.textContent, 10) || 0;
            subtotal = count * unitPrice;
          }
          subtotalCell.textContent = subtotal ? subtotal.toLocaleString() : '';
          grand += subtotal;
        });
        var totalCell = section.querySelector('.salary-grand-total');
        if (totalCell) totalCell.textContent = grand ? grand.toLocaleString() + ' 円' : '';
      }

      function bindSharedInputs() {
        document.querySelectorAll('.shared-input').forEach((element) => {
          const sharedKey = element.getAttribute('data-shared-input');
          const storageKey = getSharedInputStorageKey(sharedKey);
          const storage = getSharedStorage();
          try {
            const saved = storage ? storage.getItem(storageKey) : null;
            if (saved !== null) element.value = saved;
            if (saved === null && sharedKey === 'sheet-title') element.value = '授業日程表';
          } catch {}
          element.addEventListener('input', () => {
            try { storage && storage.setItem(storageKey, element.value); } catch {}
            document.querySelectorAll('.shared-input[data-shared-input="' + sharedKey + '"]').forEach((other) => {
              if (other !== element) other.value = element.value;
            });
            if (sharedKey === 'school-info') syncScheduleQrVisibility();
          });
        });
      }

      function readStoredRange() {
        const storage = getSharedStorage();
        try {
          return {
            startDate: storage ? storage.getItem(rangeStoragePrefix + 'start') || '' : '',
            endDate: storage ? storage.getItem(rangeStoragePrefix + 'end') || '' : '',
            periodValue: storage ? storage.getItem(rangeStoragePrefix + 'period') || '' : '',
            personId: storage ? storage.getItem(rangeStoragePrefix + 'person') || '' : '',
          };
        } catch {
          return { startDate: '', endDate: '', periodValue: '', personId: '' };
        }
      }

      function writeStoredRange(startDate, endDate, periodValue, personId) {
        const storage = getSharedStorage();
        try {
          if (!storage) return;
          storage.setItem(rangeStoragePrefix + 'start', startDate || '');
          storage.setItem(rangeStoragePrefix + 'end', endDate || '');
          storage.setItem(rangeStoragePrefix + 'period', periodValue || '');
          storage.setItem(rangeStoragePrefix + 'person', personId || '');
        } catch {}
      }

      function notifyRangeChange(startDate, endDate, periodValue, personId) {
        try {
          if (!window.opener || window.opener.closed) return;
          window.opener.postMessage({
            type: 'schedule-range-update',
            viewType: VIEW_TYPE,
            startDate: startDate || '',
            endDate: endDate || '',
            periodValue: periodValue || '',
            personId: personId || '',
          }, '*');
        } catch {}
      }

      function notifyPopupReady() {
        try {
          if (!window.opener || window.opener.closed) return;
          window.opener.postMessage({
            type: 'schedule-popup-ready',
            viewType: VIEW_TYPE,
          }, '*');
        } catch {}
      }

      function handleTeacherUnavailableClick(target) {
        const role = target.getAttribute('data-role') || '';
        if (role === 'open-teacher-register-modal') {
          openTeacherRegisterModal(target.getAttribute('data-teacher-id') || '', target.getAttribute('data-session-id') || '');
          return;
        }

        if (role === 'close-teacher-register-modal' || role === 'teacher-register-modal-backdrop') {
          closeTeacherRegisterModal();
          return;
        }

        if (role === 'submit-teacher-register-modal') {
          submitTeacherRegisterModal();
          return;
        }

        if (role === 'unsubmit-teacher-register-modal') {
          unsubmitTeacherRegisterModal();
          return;
        }

        if (role === 'toggle-teacher-unavailable-date') {
          const section = target.closest('[data-role="teacher-sheet"]');
          const teacherId = target.getAttribute('data-teacher-id') || '';
          const dateKey = target.getAttribute('data-date-key') || '';
          if (!(section instanceof HTMLElement) || !teacherId || !dateKey) return;
          const slotKeys = Array.from(section.querySelectorAll('[data-role="teacher-slot-cell"][data-editable="true"][data-date-key="' + dateKey + '"]'))
            .map((element) => element.getAttribute('data-slot-key') || '')
            .filter(Boolean);
          applyTeacherUnavailableSlots(teacherId, slotKeys);
          return;
        }

        if (role === 'toggle-teacher-unavailable-slot') {
          const section = target.closest('[data-role="teacher-sheet"]');
          const teacherId = target.getAttribute('data-teacher-id') || '';
          const slotNumber = target.getAttribute('data-slot-number') || '';
          if (!(section instanceof HTMLElement) || !teacherId || !slotNumber) return;
          const slotKeys = Array.from(section.querySelectorAll('[data-role="teacher-slot-cell"][data-editable="true"][data-slot-number="' + slotNumber + '"]'))
            .map((element) => element.getAttribute('data-slot-key') || '')
            .filter(Boolean);
          applyTeacherUnavailableSlots(teacherId, slotKeys);
          return;
        }

        const cellTarget = role === 'teacher-slot-cell' ? target : target.closest('[data-role="teacher-slot-cell"]');
        if (!(cellTarget instanceof HTMLElement) || cellTarget.getAttribute('data-editable') !== 'true') return;
        const teacherId = cellTarget.getAttribute('data-teacher-id') || target.getAttribute('data-teacher-id') || '';
        const slotKey = cellTarget.getAttribute('data-slot-key') || target.getAttribute('data-slot-key') || '';
        if (!teacherId || !slotKey) return;
        toggleTeacherUnavailableSlot(teacherId, slotKey);
      }

      function handleStudentUnavailableClick(target) {
        const role = target.getAttribute('data-role') || '';
        if (role === 'open-student-count-modal') {
          openStudentCountModal(target.getAttribute('data-student-id') || '', target.getAttribute('data-session-id') || '');
          return;
        }

        if (role === 'close-student-count-modal' || role === 'student-count-modal-backdrop') {
          closeStudentCountModal();
          return;
        }

        if (role === 'submit-student-count-modal') {
          submitStudentCountModal();
          return;
        }

        if (role === 'unsubmit-student-count-modal') {
          unsubmitStudentCountModal();
          return;
        }

        if (role === 'toggle-student-unavailable-date') {
          const section = target.closest('[data-role="student-sheet"]');
          const studentId = target.getAttribute('data-student-id') || '';
          const dateKey = target.getAttribute('data-date-key') || '';
          if (!(section instanceof HTMLElement) || !studentId || !dateKey) return;
          const slotKeys = Array.from(section.querySelectorAll('[data-role="student-slot-cell"][data-editable="true"][data-date-key="' + dateKey + '"]'))
            .map((element) => element.getAttribute('data-slot-key') || '')
            .filter(Boolean);
          applyStudentUnavailableSlots(studentId, slotKeys);
          return;
        }

        if (role === 'toggle-student-unavailable-slot') {
          const section = target.closest('[data-role="student-sheet"]');
          const studentId = target.getAttribute('data-student-id') || '';
          const slotNumber = target.getAttribute('data-slot-number') || '';
          if (!(section instanceof HTMLElement) || !studentId || !slotNumber) return;
          const slotKeys = Array.from(section.querySelectorAll('[data-role="student-slot-cell"][data-editable="true"][data-slot-number="' + slotNumber + '"]'))
            .map((element) => element.getAttribute('data-slot-key') || '')
            .filter(Boolean);
          applyStudentUnavailableSlots(studentId, slotKeys);
          return;
        }

        const cellTarget = role === 'student-slot-cell' ? target : target.closest('[data-role="student-slot-cell"]');
        if (!(cellTarget instanceof HTMLElement) || cellTarget.getAttribute('data-editable') !== 'true') return;
        const studentId = cellTarget.getAttribute('data-student-id') || target.getAttribute('data-student-id') || '';
        const slotKey = cellTarget.getAttribute('data-slot-key') || target.getAttribute('data-slot-key') || '';
        if (!studentId || !slotKey) return;
        toggleStudentUnavailableSlot(studentId, slotKey);
      }

      function handleUnavailablePointerDown(target) {
        if (isUnavailableTogglePending(target)) return true;
        const role = target.getAttribute('data-role') || '';
        if (!role.includes('unavailable') && role !== 'student-slot-cell' && role !== 'teacher-slot-cell') return false;
        if (role.includes('modal')) return false;
        if (role.includes('teacher')) {
          handleTeacherUnavailableClick(target);
          return true;
        }
        handleStudentUnavailableClick(target);
        return true;
      }

      function isDateWithinAvailableRange(dateKey) {
        return !dateKey || (dateKey >= DATA.availableStartDate && dateKey <= DATA.availableEndDate);
      }

      function getPreferredRange() {
        const stored = readStoredRange();
        const startDate = isDateWithinAvailableRange(stored.startDate) ? stored.startDate : '';
        const endDate = isDateWithinAvailableRange(stored.endDate) ? stored.endDate : '';
        return {
          startDate: startDate || DATA.defaultStartDate || DATA.availableStartDate,
          endDate: endDate || DATA.defaultEndDate || DATA.availableEndDate,
          periodValue: stored.periodValue || DATA.defaultPeriodValue || '',
        };
      }

      function syncLogo(src) {
        document.querySelectorAll('[data-shared-image="logo"]').forEach((element) => {
          element.innerHTML = src ? '<img class="logo-image" src="' + src + '" alt="logo" />' : '<span class="logo-placeholder">ロゴ欄</span>';
        });
      }

      function bindLogoControls() {
        const logoInput = document.getElementById('schedule-logo-input');
        const storageKey = sharedGlobalStoragePrefix + 'logo';
        const readStoredLogo = () => {
          const storage = getSharedStorage();
          try {
            return storage ? storage.getItem(storageKey) || '' : '';
          } catch {
            return '';
          }
        };
        try {
          syncLogo(readStoredLogo());
        } catch {
          syncLogo('');
        }
        document.addEventListener('click', (event) => {
          const target = event.target;
          if (!(target instanceof HTMLElement)) return;
          const logoBox = target.closest('[data-shared-image="logo"]');
          if (!logoBox) return;
          logoInput.click();
        });
        logoInput.addEventListener('change', () => {
          const file = logoInput.files && logoInput.files[0];
          if (!file) return;
          const reader = new FileReader();
          reader.onload = () => {
            const result = typeof reader.result === 'string' ? reader.result : '';
            syncLogo(result);
            try {
              const storage = getSharedStorage();
              storage && storage.setItem(storageKey, result);
            } catch {}
          };
          reader.readAsDataURL(file);
        });
        return readStoredLogo;
      }

      function getDraftRange() {
        let startDate = startInput.value || DATA.defaultStartDate || DATA.availableStartDate;
        let endDate = endInput.value || DATA.defaultEndDate || DATA.availableEndDate;
        if (startDate > endDate) {
          const previous = startDate;
          startDate = endDate;
          endDate = previous;
        }
        return {
          startDate,
          endDate,
          periodValue: periodSelect.value || '',
        };
      }

      // 講習集計結果: 表示期間に重なる講習期間(specialSession)を返す。空なら講習なし。
      function getOverlappingSpecialSessions(startDate, endDate) {
        return (DATA.specialSessions || []).filter(function(session) {
          return session && typeof session.startDate === 'string' && typeof session.endDate === 'string'
            && session.startDate <= endDate && session.endDate >= startDate;
        });
      }

      // 講習の登録状況を判定する純関数。countSubmitted=登録、regularOnly=通常のみ(注記)。
      // (scheduleHtml.test.ts が new Function で抽出して3状態を固定する)
      function resolveLectureRegistrationStatus(input) {
        var registered = Boolean(input && input.countSubmitted);
        var regularOnly = Boolean(input && input.regularOnly);
        if (!registered) return { label: '未登録', kind: 'unregistered' };
        if (regularOnly) return { label: '登録（通常のみ）', kind: 'regular-only' };
        return { label: '登録', kind: 'registered' };
      }

      // 講習集計結果の「希望科目(授業時間)」セル。希望科目ごとに数量と授業時間(60/45分)を並べる。
      // 例: '数60分×2 / 英×1'。90分(既定)は分数を付けない(講習回数表と同ルール)。
      // 未登録・通常のみ・希望なしは '—'。科目は SUBJECT_SORT_ORDER 順、算/数 等は生徒学年で正規化。
      function formatDesiredSubjectsWithDuration(input, student, referenceDate) {
        if (!input || !input.countSubmitted || input.regularOnly) return '—';
        var countBySubject = {};
        var minutesListBySubject = {};
        var slots = input.subjectSlots && typeof input.subjectSlots === 'object' ? input.subjectSlots : {};
        var durations = input.subjectDurations && typeof input.subjectDurations === 'object' ? input.subjectDurations : {};
        Object.keys(slots).forEach(function(subject) {
          var count = Number(slots[subject]);
          if (!Number.isFinite(count) || count <= 0) return;
          var normalizedSubject = normalizeSubjectForStudent(subject, student, referenceDate);
          countBySubject[normalizedSubject] = (countBySubject[normalizedSubject] || 0) + Math.trunc(count);
          if (!minutesListBySubject[normalizedSubject]) minutesListBySubject[normalizedSubject] = [];
          minutesListBySubject[normalizedSubject].push(formatScheduleMinutesSuffix(durations[subject]));
        });
        var subjects = Object.keys(countBySubject).sort(function(left, right) {
          var li = SUBJECT_SORT_ORDER.indexOf(left);
          var ri = SUBJECT_SORT_ORDER.indexOf(right);
          if (li !== -1 && ri !== -1) return li - ri;
          if (li !== -1) return -1;
          if (ri !== -1) return 1;
          return left.localeCompare(right, 'ja');
        });
        if (!subjects.length) return '—';
        return subjects.map(function(subject) {
          var minutesSuffix = pickLectureMinutesSuffix(minutesListBySubject[subject] || []);
          return subject + (minutesSuffix ? minutesSuffix + '分' : '') + '×' + countBySubject[subject];
        }).join(' / ');
      }

      // 講習集計結果の「提出日時」セル。ISO文字列を JST(M/D HH:MM)で返す。未提出/不正は '—'。
      // ランタイムのタイムゾーンに依存しないよう +9h した上で UTC 成分を読む(CIのUTCでも同結果=テスト決定的)。
      // (scheduleHtml.test.ts が new Function で抽出して固定する)
      function formatSubmissionDateTime(submittedAt) {
        if (typeof submittedAt !== 'string' || !submittedAt) return '—';
        var ms = Date.parse(submittedAt);
        if (isNaN(ms)) return '—';
        var jst = new Date(ms + 9 * 60 * 60 * 1000);
        var month = jst.getUTCMonth() + 1;
        var day = jst.getUTCDate();
        var hours = ('0' + jst.getUTCHours()).slice(-2);
        var minutes = ('0' + jst.getUTCMinutes()).slice(-2);
        return month + '/' + day + ' ' + hours + ':' + minutes;
      }

      // 講習集計結果の「提出方法」セル。'qr'=QR提出、'manual'=室長登録。
      // 未登録は '—'、登録済みでも方法不明(この機能導入前の既存データ)は '—'。
      // (scheduleHtml.test.ts が new Function で抽出して固定する)
      function resolveSubmissionMethodLabel(input) {
        if (!input || !input.countSubmitted) return '—';
        if (input.submissionMethod === 'qr') return 'QR提出';
        if (input.submissionMethod === 'manual') return '室長登録';
        return '—';
      }

      // 講習集計結果の「オプション」セル。チェック済み(optionChecks[i]===true)の行のラベルを ' / ' で並べる。
      // ラベルは学年共通(labels[i])。チェック済みだがラベル未設定の行は 'オプションN' で補う。未チェックは '—'。
      // labels は5要素の配列。optionChecks はキー'0'..'4'のレコード(QR提出/室長登録)。
      // (scheduleHtml.test.ts が new Function で抽出して固定する)
      function formatLectureOptionCell(input, labels) {
        // 未登録(未提出)は希望科目/提出方法列と同じく '—'(登録済みの生徒のみオプションを表示・登録状況列と整合)。
        if (!input || !input.countSubmitted) return '—';
        var checks = input.optionChecks && typeof input.optionChecks === 'object' ? input.optionChecks : null;
        if (!checks) return '—';
        var parts = [];
        for (var i = 0; i < 5; i++) {
          if (checks[i] !== true) continue;
          var label = labels && typeof labels[i] === 'string' ? labels[i].trim() : '';
          parts.push(label || ('オプション' + (i + 1)));
        }
        return parts.length ? parts.join(' / ') : '—';
      }

      // 表示期間の講習について、全生徒の登録/未登録一覧HTML(自己完結ページ)を組み立てる。
      function buildLectureSummaryHtml(startDate, endDate) {
        var sessions = getOverlappingSpecialSessions(startDate, endDate);
        var students = getVisibleStudents(startDate, endDate);
        var statusClassMap = { unregistered: 'lecture-summary-unregistered', 'regular-only': 'lecture-summary-regular-only', registered: 'lecture-summary-registered' };
        // オプション欄は開発用教室のみ(空フォーマット/生徒日程表と同じゲート)。列とラベル取得を実行時に切り替える。
        var optionEnabled = !!DATA.optionFieldEnabled;
        function getStudentOptionLabels(student) {
          var grade = (student && student.currentGradeLabel) || '未設定';
          var labels = [];
          for (var i = 0; i < 5; i++) labels.push(getScheduleNoteValue('student-option-grade-' + grade + '-' + i));
          return labels;
        }
        var optionHeader = optionEnabled ? '<th>オプション</th>' : '';
        var emptyColspan = optionEnabled ? 7 : 6;
        var sectionsHtml = sessions.map(function(session) {
          var inputs = session && session.studentInputs && typeof session.studentInputs === 'object' ? session.studentInputs : {};
          var counts = { registered: 0, 'regular-only': 0, unregistered: 0 };
          var optionCount = 0;
          var rowsHtml = students.map(function(student, index) {
            var status = resolveLectureRegistrationStatus(inputs[student.id]);
            counts[status.kind] += 1;
            var optionCell = '';
            if (optionEnabled) {
              var optionText = formatLectureOptionCell(inputs[student.id], getStudentOptionLabels(student));
              if (optionText !== '—') optionCount += 1;
              optionCell = '<td class="lecture-summary-option">' + escapeHtml(optionText) + '</td>';
            }
            return '<tr><td class="lecture-summary-index">' + (index + 1) + '</td>'
              + '<td class="lecture-summary-name">' + escapeHtml(formatStudentHeaderName(student, startDate)) + '</td>'
              + '<td class="' + statusClassMap[status.kind] + '">' + escapeHtml(status.label) + '</td>'
              + '<td class="lecture-summary-subjects">' + escapeHtml(formatDesiredSubjectsWithDuration(inputs[student.id], student, startDate)) + '</td>'
              + '<td class="lecture-summary-submitted-at">' + escapeHtml(formatSubmissionDateTime(inputs[student.id] && inputs[student.id].submittedAt)) + '</td>'
              + '<td class="lecture-summary-method">' + escapeHtml(resolveSubmissionMethodLabel(inputs[student.id])) + '</td>'
              + optionCell + '</tr>';
          }).join('');
          if (!rowsHtml) rowsHtml = '<tr><td colspan="' + emptyColspan + '" class="lecture-summary-empty">表示対象の生徒がいません</td></tr>';
          var rangeLabel = formatRangeLabel(session.startDate, session.endDate);
          var summaryLine = '登録 ' + counts.registered + '人 / 通常のみ ' + counts['regular-only'] + '人 / 未登録 ' + counts.unregistered + '人（全 ' + students.length + '人）'
            + (optionEnabled ? ' / オプション有 ' + optionCount + '人' : '');
          return '<section class="lecture-summary-section">'
            + '<h2>' + escapeHtml(session.label || '講習') + '<span class="lecture-summary-range">' + escapeHtml(rangeLabel) + '</span></h2>'
            + '<p class="lecture-summary-count">' + escapeHtml(summaryLine) + '</p>'
            + '<table class="lecture-summary-table"><thead><tr><th>No.</th><th>生徒名</th><th>登録状況</th><th>希望科目（授業時間）</th><th>提出日時</th><th>提出方法</th>' + optionHeader + '</tr></thead>'
            + '<tbody>' + rowsHtml + '</tbody></table></section>';
        }).join('');
        if (!sectionsHtml) sectionsHtml = '<p class="lecture-summary-empty">表示期間に講習期間が含まれていません。</p>';
        var title = '講習集計結果';
        // padding-bottom は最下部がWindowsタスクバー等に隠れないようスクロール余白を確保する(印刷時は0に戻す)。
        var style = 'body{font-family:sans-serif;margin:24px;padding-bottom:160px;color:#1f2933;}'
          + 'h1{font-size:20px;margin:0 0 4px;}'
          + '.lecture-summary-subtitle{color:#52606d;font-size:13px;margin:0 0 20px;}'
          + '.lecture-summary-section{margin-bottom:28px;}'
          + '.lecture-summary-section h2{font-size:16px;margin:0 0 6px;border-bottom:2px solid #cbd2d9;padding-bottom:4px;}'
          + '.lecture-summary-range{font-size:12px;color:#52606d;font-weight:normal;margin-left:10px;}'
          + '.lecture-summary-count{font-size:13px;color:#52606d;margin:0 0 10px;}'
          + '.lecture-summary-table{border-collapse:collapse;width:100%;max-width:920px;}'
          + '.lecture-summary-table th,.lecture-summary-table td{border:1px solid #cbd2d9;padding:6px 10px;text-align:left;font-size:14px;}'
          + '.lecture-summary-table th{background:#f5f7fa;}'
          + '.lecture-summary-index{width:44px;text-align:right;color:#7b8794;}'
          + '.lecture-summary-name{white-space:nowrap;}'
          + '.lecture-summary-subjects{color:#1f2933;}'
          + '.lecture-summary-submitted-at{white-space:nowrap;color:#1f2933;}'
          + '.lecture-summary-method{white-space:nowrap;color:#334e68;}'
          + '.lecture-summary-option{color:#1f2933;}'
          + '.lecture-summary-registered{color:#0b7a3b;font-weight:bold;}'
          + '.lecture-summary-regular-only{color:#b45309;font-weight:bold;}'
          + '.lecture-summary-unregistered{color:#9aa5b1;}'
          + '.lecture-summary-empty{color:#7b8794;}'
          + '.lecture-summary-print{margin:0 0 20px;}'
          + '@media print{.lecture-summary-print{display:none;}body{padding-bottom:0;}}';
        var printButton = '<div class="lecture-summary-print"><button type="button" onclick="window.print()">印刷</button></div>';
        return '<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>' + escapeHtml(title) + '</title>'
          + '<style>' + style + '</style></head><body>'
          + '<h1>' + escapeHtml(title) + '</h1>'
          + '<p class="lecture-summary-subtitle">' + escapeHtml('表示期間: ' + formatRangeLabel(startDate, endDate)) + '</p>'
          + printButton + sectionsHtml + '</body></html>';
      }

      // 表示期間の講習について、全講師の登録/未登録一覧HTML(自己完結ページ)を組み立てる。
      // 生徒版と異なり希望科目列は出さない(講師は科目提出がないため・オーナー指示 2026-07-09)。
      function buildTeacherLectureSummaryHtml(startDate, endDate) {
        var sessions = getOverlappingSpecialSessions(startDate, endDate);
        var teachers = getVisibleTeachers(startDate, endDate);
        var sectionsHtml = sessions.map(function(session) {
          var inputs = session && session.teacherInputs && typeof session.teacherInputs === 'object' ? session.teacherInputs : {};
          var registeredCount = 0;
          var rowsHtml = teachers.map(function(teacher, index) {
            var input = inputs[teacher.id];
            var registered = Boolean(input && input.countSubmitted);
            if (registered) registeredCount += 1;
            var statusLabel = registered ? '登録' : '未登録';
            var statusClass = registered ? 'lecture-summary-registered' : 'lecture-summary-unregistered';
            return '<tr><td class="lecture-summary-index">' + (index + 1) + '</td>'
              + '<td class="lecture-summary-name">' + escapeHtml(formatTeacherHeaderName(teacher)) + '</td>'
              + '<td class="' + statusClass + '">' + escapeHtml(statusLabel) + '</td>'
              + '<td class="lecture-summary-submitted-at">' + escapeHtml(formatSubmissionDateTime(input && input.submittedAt)) + '</td>'
              + '<td class="lecture-summary-method">' + escapeHtml(resolveSubmissionMethodLabel(input)) + '</td></tr>';
          }).join('');
          if (!rowsHtml) rowsHtml = '<tr><td colspan="5" class="lecture-summary-empty">表示対象の講師がいません</td></tr>';
          var rangeLabel = formatRangeLabel(session.startDate, session.endDate);
          var summaryLine = '登録 ' + registeredCount + '人 / 未登録 ' + (teachers.length - registeredCount) + '人（全 ' + teachers.length + '人）';
          return '<section class="lecture-summary-section">'
            + '<h2>' + escapeHtml(session.label || '講習') + '<span class="lecture-summary-range">' + escapeHtml(rangeLabel) + '</span></h2>'
            + '<p class="lecture-summary-count">' + escapeHtml(summaryLine) + '</p>'
            + '<table class="lecture-summary-table"><thead><tr><th>No.</th><th>講師名</th><th>登録状況</th><th>提出日時</th><th>提出方法</th></tr></thead>'
            + '<tbody>' + rowsHtml + '</tbody></table></section>';
        }).join('');
        if (!sectionsHtml) sectionsHtml = '<p class="lecture-summary-empty">表示期間に講習期間が含まれていません。</p>';
        var title = '講習集計結果（講師）';
        var style = 'body{font-family:sans-serif;margin:24px;padding-bottom:160px;color:#1f2933;}'
          + 'h1{font-size:20px;margin:0 0 4px;}'
          + '.lecture-summary-subtitle{color:#52606d;font-size:13px;margin:0 0 20px;}'
          + '.lecture-summary-section{margin-bottom:28px;}'
          + '.lecture-summary-section h2{font-size:16px;margin:0 0 6px;border-bottom:2px solid #cbd2d9;padding-bottom:4px;}'
          + '.lecture-summary-range{font-size:12px;color:#52606d;font-weight:normal;margin-left:10px;}'
          + '.lecture-summary-count{font-size:13px;color:#52606d;margin:0 0 10px;}'
          + '.lecture-summary-table{border-collapse:collapse;width:100%;max-width:720px;}'
          + '.lecture-summary-table th,.lecture-summary-table td{border:1px solid #cbd2d9;padding:6px 10px;text-align:left;font-size:14px;}'
          + '.lecture-summary-table th{background:#f5f7fa;}'
          + '.lecture-summary-index{width:44px;text-align:right;color:#7b8794;}'
          + '.lecture-summary-name{white-space:nowrap;}'
          + '.lecture-summary-submitted-at{white-space:nowrap;color:#1f2933;}'
          + '.lecture-summary-method{white-space:nowrap;color:#334e68;}'
          + '.lecture-summary-registered{color:#0b7a3b;font-weight:bold;}'
          + '.lecture-summary-unregistered{color:#9aa5b1;}'
          + '.lecture-summary-empty{color:#7b8794;}'
          + '.lecture-summary-print{margin:0 0 20px;}'
          + '@media print{.lecture-summary-print{display:none;}body{padding-bottom:0;}}';
        var printButton = '<div class="lecture-summary-print"><button type="button" onclick="window.print()">印刷</button></div>';
        return '<!doctype html><html lang="ja"><head><meta charset="utf-8"><title>' + escapeHtml(title) + '</title>'
          + '<style>' + style + '</style></head><body>'
          + '<h1>' + escapeHtml(title) + '</h1>'
          + '<p class="lecture-summary-subtitle">' + escapeHtml('表示期間: ' + formatRangeLabel(startDate, endDate)) + '</p>'
          + printButton + sectionsHtml + '</body></html>';
      }

      function updateLectureSummaryButtonVisibility(startDate, endDate) {
        var button = document.getElementById('schedule-lecture-summary-button');
        if (!button) return;
        button.style.display = getOverlappingSpecialSessions(startDate, endDate).length > 0 ? '' : 'none';
      }

      function render() {
        let startDate = appliedStartDate || DATA.defaultStartDate || DATA.availableStartDate;
        let endDate = appliedEndDate || DATA.defaultEndDate || DATA.availableEndDate;
        if (startDate > endDate) {
          const previous = startDate;
          startDate = endDate;
          endDate = previous;
          appliedStartDate = startDate;
          appliedEndDate = endDate;
        }

        if (VIEW_TYPE === 'all-student' || VIEW_TYPE === 'all-teacher' || VIEW_TYPE === 'all') {
          try {
            renderAllPages(startDate, endDate);
          } catch (error) {
            pagesElement.innerHTML = '<div class="empty-state">表示中にエラーが発生しました: ' + escapeHtml(String(error)) + '</div>';
          }
          // タブ名は取り違え防止のため「教室名」を出す。期間は出さない(2026-07-09 オーナー指示)。
          document.title = VIEW_LABEL + (DATA.classroomName ? ' | ' + DATA.classroomName : '');
          updateSheetScreenSize();
          bindNotes();
          bindSalaryInputs();
          bindSharedInputs();
          if (window.__scheduleReadStoredLogo) syncLogo(window.__scheduleReadStoredLogo());
          return;
        }

        const visiblePeople = VIEW_TYPE === 'student' ? getVisibleStudents(startDate, endDate) : getVisibleTeachers(startDate, endDate);
        if (!visiblePeople.some((person) => person.id === appliedPersonId)) {
          appliedPersonId = getDefaultAppliedPersonId(startDate, endDate);
        }

        let displayedPerson = null;
        try {
          if (VIEW_TYPE === 'student') displayedPerson = renderStudentPages(startDate, endDate, appliedPersonId);
          else displayedPerson = renderTeacherPages(startDate, endDate, appliedPersonId);
          if (VIEW_TYPE === 'student') pagesElement.insertAdjacentHTML('beforeend', renderStudentCountModal());
          if (VIEW_TYPE === 'teacher') pagesElement.insertAdjacentHTML('beforeend', renderTeacherRegisterModal());
        } catch (error) {
          pagesElement.innerHTML = '<div class="empty-state">表示中にエラーが発生しました: ' + escapeHtml(String(error)) + '</div>';
        }

        const personLabel = displayedPerson
          ? (VIEW_TYPE === 'student' ? formatStudentHeaderName(displayedPerson, startDate) : formatTeacherHeaderName(displayedPerson))
          : '対象なし';
        if (summaryLabel) summaryLabel.textContent = '表示中: ' + formatRangeLabel(startDate, endDate) + ' / ' + personLabel;
        // タブ名は「教室名」を出す(期間は出さない)。生徒/講師名は残す(2026-07-09 オーナー指示)。
        document.title = VIEW_LABEL + (DATA.classroomName ? ' | ' + DATA.classroomName : '') + ' | ' + personLabel;
        updateSheetScreenSize();
        syncPendingUnavailableUi(pagesElement);
        bindNotes();
        bindSalaryInputs();
        bindSharedInputs();
        if (window.__scheduleReadStoredLogo) syncLogo(window.__scheduleReadStoredLogo());
        syncScheduleQrVisibility();
        updateLectureSummaryButtonVisibility(startDate, endDate);
      }

      function setRangeAndRender(nextStartDate, nextEndDate, nextPeriodValue, nextPersonId) {
        let startDate = nextStartDate || DATA.defaultStartDate || DATA.availableStartDate;
        let endDate = nextEndDate || DATA.defaultEndDate || DATA.availableEndDate;
        if (startDate > endDate) {
          const previous = startDate;
          startDate = endDate;
          endDate = previous;
        }
        appliedStartDate = startDate;
        appliedEndDate = endDate;
        appliedPeriodValue = nextPeriodValue || '';
        setDateInputValue(startInput, startDate);
        setDateInputValue(endInput, endDate);
        syncPeriodSelectOptions(nextPeriodValue);
        appliedPersonId = nextPersonId || getDefaultAppliedPersonId(startDate, endDate);
        appliedPersonId = syncPersonSelectOptions(appliedPersonId) || appliedPersonId;
        writeStoredRange(startDate, endDate, periodSelect.value || nextPeriodValue || '', appliedPersonId);
        notifyRangeChange(startDate, endDate, periodSelect.value || nextPeriodValue || '', appliedPersonId);
        render();
      }

      function handleDateInputChange() {
        syncPeriodSelectOptions('');
        syncPersonSelectOptions(personSelect.value || appliedPersonId);
      }

      function handlePeriodDraftChange() {
        if (periodSelect.value) {
          const [startDate, endDate] = periodSelect.value.split('|');
          setDateInputValue(startInput, startDate || DATA.defaultStartDate || DATA.availableStartDate);
          setDateInputValue(endInput, endDate || DATA.defaultEndDate || DATA.availableEndDate);
        }
        syncPersonSelectOptions(personSelect.value || appliedPersonId);
      }

      function applyFilters() {
        const draftRange = getDraftRange();
        const selectedPersonId = syncPersonSelectOptions(personSelect.value || appliedPersonId)
          || getDefaultAppliedPersonId(draftRange.startDate, draftRange.endDate);
        personSelectionLocked = true;
        setRangeAndRender(draftRange.startDate, draftRange.endDate, draftRange.periodValue, selectedPersonId);
      }

      if (VIEW_TYPE === 'all-student' || VIEW_TYPE === 'all-teacher' || VIEW_TYPE === 'all') {
        window.__scheduleReadStoredLogo = bindLogoControls();
        appliedStartDate = DATA.defaultStartDate || DATA.availableStartDate;
        appliedEndDate = DATA.defaultEndDate || DATA.availableEndDate;
        render();
      } else {

      const emptyFormatButton = document.getElementById('schedule-empty-format-button');
      if (emptyFormatButton) {
        emptyFormatButton.addEventListener('click', function() {
          openEmptyFormatPrintWindow();
        });
      }

      const showAllButton = document.getElementById('schedule-show-all-button');
      if (showAllButton) {
        showAllButton.addEventListener('click', function() {
          if (window.opener && !window.opener.closed) {
            var currentStartDate = (startInput && startInput.value) || appliedStartDate || DATA.defaultStartDate || DATA.availableStartDate;
            var currentEndDate = (endInput && endInput.value) || appliedEndDate || DATA.defaultEndDate || DATA.availableEndDate;
            var allViewType = VIEW_TYPE === 'student' ? 'all-student' : 'all-teacher';
            var targetWindowName = 'schedule-print-all-' + allViewType + '-' + Date.now();
            var targetWindow = window.open('', targetWindowName);
            if (targetWindow) {
              targetWindow.document.open();
              targetWindow.document.write('<!doctype html><html><head><meta charset="utf-8"><title>印刷用全員表示</title></head><body style="font-family: sans-serif; padding: 24px;">印刷用全員表示を準備しています...</body></html>');
              targetWindow.document.close();
            }
            window.opener.postMessage({
              type: 'open-all-schedule',
              viewType: allViewType,
              startDate: currentStartDate,
              endDate: currentEndDate,
              targetWindowName: targetWindowName,
            }, '*');
          }
        });
      }

      const lectureSummaryButton = document.getElementById('schedule-lecture-summary-button');
      if (lectureSummaryButton) {
        lectureSummaryButton.addEventListener('click', function() {
          var currentStartDate = (startInput && startInput.value) || appliedStartDate || DATA.defaultStartDate || DATA.availableStartDate;
          var currentEndDate = (endInput && endInput.value) || appliedEndDate || DATA.defaultEndDate || DATA.availableEndDate;
          if (currentStartDate > currentEndDate) {
            var swap = currentStartDate;
            currentStartDate = currentEndDate;
            currentEndDate = swap;
          }
          if (getOverlappingSpecialSessions(currentStartDate, currentEndDate).length === 0) return;
          var summaryHtml = VIEW_TYPE === 'teacher'
            ? buildTeacherLectureSummaryHtml(currentStartDate, currentEndDate)
            : buildLectureSummaryHtml(currentStartDate, currentEndDate);
          var summaryWindow = window.open('', 'lecture-summary-' + Date.now());
          if (summaryWindow) {
            summaryWindow.document.open();
            summaryWindow.document.write(summaryHtml);
            summaryWindow.document.close();
          }
        });
      }

      const preferredRange = getPreferredRange();
      refreshInteractionLockState();
      startInput.addEventListener('input', handleDateInputChange);
      endInput.addEventListener('input', handleDateInputChange);
      startInput.addEventListener('change', handleDateInputChange);
      endInput.addEventListener('change', handleDateInputChange);
      startInput.addEventListener('blur', handleDateInputChange);
      endInput.addEventListener('blur', handleDateInputChange);
      periodSelect.addEventListener('input', handlePeriodDraftChange);
      periodSelect.addEventListener('change', handlePeriodDraftChange);
      personSearchInput.addEventListener('input', () => {
        syncPersonSelectOptions();
      });
      personSearchInput.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        applyFilters();
      });
      personSelect.addEventListener('keydown', (event) => {
        if (event.key !== 'Enter') return;
        event.preventDefault();
        applyFilters();
      });
      applyButton.addEventListener('click', applyFilters);
      // 日程表コマ組み(別タブD&D): 空きコマトグルより前に登録し、掴めるカードのときだけ後続を止める。
      setupScheduleDndMove();
      document.addEventListener('pointerdown', (event) => {
        if (!(event instanceof PointerEvent) || event.button !== 0) return;
        acquireInteractionLock();
      }, true);
      pagesElement.addEventListener('pointerdown', (event) => {
        if (event.button !== 0) return;
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const toggleTarget = target.closest('[data-role="toggle-student-unavailable"], [data-role="student-slot-cell"], [data-role="toggle-student-unavailable-date"], [data-role="toggle-student-unavailable-slot"], [data-role="toggle-teacher-unavailable"], [data-role="teacher-slot-cell"], [data-role="toggle-teacher-unavailable-date"], [data-role="toggle-teacher-unavailable-slot"]');
        if (!toggleTarget || !(toggleTarget instanceof HTMLElement)) return;
        if (!handleUnavailablePointerDown(toggleTarget)) return;
        suppressNextToggleClick = true;
        window.setTimeout(() => {
          suppressNextToggleClick = false;
        }, 0);
        event.preventDefault();
      });
      pagesElement.addEventListener('click', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLElement)) return;
        const toggleTarget = target.closest('[data-role="open-student-count-modal"], [data-role="close-student-count-modal"], [data-role="submit-student-count-modal"], [data-role="unsubmit-student-count-modal"], [data-role="student-count-modal-backdrop"], [data-role="open-teacher-register-modal"], [data-role="close-teacher-register-modal"], [data-role="submit-teacher-register-modal"], [data-role="unsubmit-teacher-register-modal"], [data-role="teacher-register-modal-backdrop"]');
        if (!toggleTarget || !(toggleTarget instanceof HTMLElement)) return;
        if (toggleTarget.getAttribute('data-role') === 'student-count-modal-backdrop' && toggleTarget !== target) return;
        if (toggleTarget.getAttribute('data-role') === 'teacher-register-modal-backdrop' && toggleTarget !== target) return;
        if ((toggleTarget.getAttribute('data-role') || '').includes('teacher')) {
          handleTeacherUnavailableClick(toggleTarget);
          return;
        }
        handleStudentUnavailableClick(toggleTarget);
      });
      pagesElement.addEventListener('change', (event) => {
        const target = event.target;
        if (!(target instanceof HTMLInputElement)) return;
        if (target.getAttribute('data-role') !== 'student-count-regular-only') return;
        document.querySelectorAll('[data-role="student-count-subject-input"]').forEach((element) => {
          if (element instanceof HTMLInputElement) element.disabled = Boolean(target.checked);
        });
        // 通常のみON時は授業時間プルダウンも無効化(回数入力と同じ扱い)。
        document.querySelectorAll('[data-role="student-count-subject-duration"]').forEach((element) => {
          if (element instanceof HTMLSelectElement) element.disabled = Boolean(target.checked);
        });
      });
      window.addEventListener('beforeunload', () => {
        releaseInteractionLock();
        notifyRangeChange(appliedStartDate, appliedEndDate, appliedPeriodValue, appliedPersonId);
      });
      window.addEventListener('focus', acquireInteractionLock);
      window.addEventListener('blur', releaseInteractionLock);
      window.addEventListener('storage', (event) => {
        if (event.key === interactionLockStorageKey) refreshInteractionLockState();
      });
      document.addEventListener('visibilitychange', () => {
        if (document.hidden) {
          releaseInteractionLock();
          return;
        }
        if (document.hasFocus()) acquireInteractionLock();
      });
      window.addEventListener('resize', updateSheetScreenSize);
      if (window.visualViewport) {
        window.visualViewport.addEventListener('resize', updateSheetScreenSize);
        window.visualViewport.addEventListener('scroll', updateSheetScreenSize);
      }
      window.setInterval(() => {
        const currentLock = readInteractionLock();
        if (document.hidden || !document.hasFocus()) {
          if (currentLock && currentLock.token === interactionLockToken) releaseInteractionLock();
          return;
        }
        if (currentLock && currentLock.token === interactionLockToken) {
          acquireInteractionLock();
        } else {
          refreshInteractionLockState();
        }
      }, 1000);
      window.addEventListener('message', (event) => {
        const message = event.data;
        if (message && message.type === 'schedule-force-release-interaction') {
          interactionLockSuspendUntil = Date.now() + 1500;
          releaseInteractionLock();
          return;
        }
        // 日程表コマ組みの結果ack: 成功=移動先コマを数秒ハイライト / 失敗=理由を大きく表示。
        if (message && message.type === 'schedule-student-move-result') {
          handleScheduleMoveResult(message);
          return;
        }
        if (!message || message.type !== 'schedule-data-update' || message.viewType !== VIEW_TYPE || !message.payload) return;
        scheduleIncomingPayload(message.payload);
      });
      window.__scheduleReadStoredLogo = bindLogoControls();
      setRangeAndRender(
        preferredRange.startDate,
        preferredRange.endDate,
        preferredRange.periodValue,
        preferredRange.personId || DATA.defaultPersonId || getDefaultAppliedPersonId(preferredRange.startDate, preferredRange.endDate),
      );
      if (!document.hidden && document.hasFocus()) acquireInteractionLock();
      window.setTimeout(() => {
        notifyPopupReady();
      }, 0);

      } // end if VIEW_TYPE !== 'all'
    </script>
  </body>
</html>`
}

function openScheduleHtml(payload: SchedulePayload, viewType: 'student' | 'teacher', targetWindow?: Window | null) {
  registerScheduleQrBuilder()
  const popupWindow = createPopupWindow(payload.titleLabel + '-' + viewType, targetWindow)
  if (!popupWindow) {
    alert(`${viewType === 'student' ? '生徒' : '講師'}日程を開けませんでした。ポップアップを許可してください。`)
    return null
  }

  const html = createScheduleHtml(payload, viewType)
  const writeScheduleDocument = () => {
    popupWindow.document.open()
    popupWindow.document.write(html)
    popupWindow.document.close()
  }

  writeScheduleDocument()
  window.setTimeout(() => {
    try {
      if (!popupWindow.document.getElementById('schedule-pages') || !popupWindow.document.querySelector('.sheet')) {
        writeScheduleDocument()
      }
    } catch {
      writeScheduleDocument()
    }
  }, 0)
  popupWindow.focus()
  return popupWindow
}

function postSchedulePayload(targetWindow: Window | null | undefined, viewType: 'student' | 'teacher', payload: SchedulePayload) {
  registerScheduleQrBuilder()
  if (!targetWindow || targetWindow.closed) return
  try {
    const directWindow = targetWindow as Window & {
      __scheduleViewType?: string
      __applySchedulePayload?: (nextPayload: SchedulePayload) => void
      __pendingSchedulePayload?: { viewType: 'student' | 'teacher'; payload: SchedulePayload } | null
    }
    directWindow.__pendingSchedulePayload = { viewType, payload }
    if ((!directWindow.__scheduleViewType || directWindow.__scheduleViewType === viewType) && typeof directWindow.__applySchedulePayload === 'function') {
      directWindow.__applySchedulePayload(payload)
      return
    }
  } catch {
    // Fall back to postMessage when the popup is not ready yet or is cross-origin.
  }
  targetWindow.postMessage({ type: 'schedule-data-update', viewType, payload }, '*')
}

export function openStudentScheduleHtml(params: OpenStudentScheduleHtmlParams) {
  return openScheduleHtml(buildStudentPayload(params), 'student', params.targetWindow)
}

export function openTeacherScheduleHtml(params: OpenTeacherScheduleHtmlParams) {
  return openScheduleHtml(buildTeacherPayload(params), 'teacher', params.targetWindow)
}

export function openAllScheduleHtml(params: OpenAllScheduleHtmlParams & { viewType?: 'all-student' | 'all-teacher' }) {
  registerScheduleQrBuilder()
  const viewType = params.viewType || 'all-student'
  const payload = buildAllPayload(params)
  const viewLabel = viewType === 'all-student' ? '印刷用生徒日程表' : '印刷用講師日程表'
  const popupWindow = createPopupWindow(params.targetWindowName || payload.titleLabel + '-' + viewType)
  if (!popupWindow) {
    alert(viewLabel + 'を開けませんでした。ポップアップを許可してください。')
    return null
  }

  const html = createScheduleHtml(payload, viewType)
  const writeScheduleDocument = () => {
    popupWindow.document.open()
    popupWindow.document.write(html)
    popupWindow.document.close()
  }

  writeScheduleDocument()
  window.setTimeout(() => {
    try {
      if (!popupWindow.document.getElementById('schedule-pages')) {
        writeScheduleDocument()
      }
    } catch {
      writeScheduleDocument()
    }
  }, 0)
  popupWindow.focus()
  return popupWindow
}

export function syncStudentScheduleHtml(params: OpenStudentScheduleHtmlParams) {
  if (!params.targetWindow || params.targetWindow.closed) return
  postSchedulePayload(params.targetWindow, 'student', buildStudentPayload(params))
}

export function syncTeacherScheduleHtml(params: OpenTeacherScheduleHtmlParams) {
  if (!params.targetWindow || params.targetWindow.closed) return
  postSchedulePayload(params.targetWindow, 'teacher', buildTeacherPayload(params))
}

export function formatWeeklyScheduleTitle(startDate: string, endDate: string) {
  if (!startDate || !endDate) return '週間予定表'
  const startParts = startDate.split('-')
  const endParts = endDate.split('-')
  return `週間予定表${Number(startParts[1])}月${Number(startParts[2])}日-${Number(endParts[1])}月${Number(endParts[2])}日`
}
