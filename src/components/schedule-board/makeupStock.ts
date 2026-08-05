import type { ClassroomSettings } from '../../types/appState'
import { formatStudentSelectionLabel, isActiveOnDate, type StudentRow, type TeacherRow } from '../basic-data/basicDataModel'
import { hasManagedRegularLessonPeriod, resolveOperationalSchoolYear, resolveRegularLessonParticipantPeriod, type RegularLessonRow } from '../basic-data/regularLessonModel'
import type { SlotCell, StudentEntry } from './types'

type OriginMap = Record<string, string[]>

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
  absentMakeupOrigins: number
  manualAdjustments: number
  plannedMakeups: number
  totalLessonCount: number
  assignedRegularLessons: number
  assignedMakeupLessons: number
  overAssignedRegularLessons: number
  remainingOriginDates: string[]
  /** remainingOriginDates と同じ並びの時限（不明なら null）。同じ日付が2件並ぶのはここで区別する。 */
  remainingOriginSlots: (number | null)[]
  remainingOriginLabels: string[]
  remainingOriginReasonLabels: string[]
  nextOriginDate: string | null
  nextOriginSlot: number | null
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

function buildOriginLabels(originTokens: string[], key: string, regularLessons: RegularLessonRow[]) {
  return originTokens.map((token) => {
    const { dateKey, slotNumber } = parseOriginToken(token)
    return formatOriginLabel(dateKey, slotNumber ?? resolveOriginSlotNumber(key, dateKey, regularLessons) ?? null)
  })
}

function resolveOriginReasonLabel(originToken: string, params: {
  classroomSettings: ClassroomSettings
  autoOriginDates: string[]
  conflictOriginDates: string[]
  manualOriginDates: string[]
  absentMakeupOriginDates: string[]
  manualOriginReasonLabels: Record<string, string>
}) {
  const { classroomSettings, autoOriginDates, conflictOriginDates, manualOriginDates, absentMakeupOriginDates, manualOriginReasonLabels } = params
  const dateKey = originTokenDateKey(originToken)
  // 発生源の判定はトークン一致（日付＋時限）を優先し、時限が食い違う場合は日付一致で拾う。
  const isFrom = (tokens: string[]) => tokens.includes(originToken) || tokens.some((token) => originTokenDateKey(token) === dateKey)

  if (!isDateKey(dateKey)) {
    if (isFrom(manualOriginDates)) return manualOriginReasonLabels[dateKey] ?? '手動調整'
    return '振替発生'
  }

  if (classroomSettings.holidayDates.includes(dateKey) && !classroomSettings.forceOpenDates.includes(dateKey)) {
    return '休日振替'
  }
  if (classroomSettings.closedWeekdays.includes(parseDateKey(dateKey).getDay()) && !classroomSettings.forceOpenDates.includes(dateKey)) {
    return '定休日振替'
  }
  if (isFrom(conflictOriginDates)) {
    return '同時間帯の重複'
  }
  if (isFrom(manualOriginDates)) {
    return manualOriginReasonLabels[dateKey] ?? '手動調整'
  }
  if (isFrom(autoOriginDates)) {
    return '休校日'
  }
  // 台帳に無い origin は「別日へ移動した授業を休みにした」ぶん(collectAbsentMakeupOrigins)。
  // 台帳側に同じ日付があればそちらのラベルが優先されるよう、この判定は最後に置く。
  if (isFrom(absentMakeupOriginDates)) {
    return '振替コマの欠席'
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

  return getScheduledDatesInMonth(year, monthIndex, row.dayOfWeek)
    .filter((dateKey) => dateKey >= activeStartKey && dateKey <= activeEndKey)
    .length
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

function buildRegularAssignmentPeriodsByKey(regularLessons: RegularLessonRow[]) {
  const periodsByKey: Record<string, Array<{ startDate: string; endDate: string }>> = {}

  for (const row of regularLessons) {
    const period = resolveRegularLessonParticipantPeriod(row)
    const participants = [
      { studentId: row.student1Id, subject: row.subject1 },
      { studentId: row.student2Id, subject: row.subject2 },
    ].filter((entry) => entry.studentId && entry.subject)

    for (const participant of participants) {
      const key = buildMakeupStockKey(participant.studentId, participant.subject)
      periodsByKey[key] = [...(periodsByKey[key] ?? []), period]
    }
  }

  return periodsByKey
}

function countAssignedRegularLessonsByKey(
  weeks: SlotCell[][],
  resolveStudentKey: (student: StudentEntry) => string,
  regularLessons: RegularLessonRow[],
) {
  const counts: Record<string, number> = {}
  const periodsByKey = buildRegularAssignmentPeriodsByKey(regularLessons)

  for (const week of weeks) {
    for (const cell of week) {
      if (!cell.isOpenDay) continue
      for (const desk of cell.desks) {
        for (const student of desk.lesson?.studentSlots ?? []) {
          if (!student || student.manualAdded || student.lessonType !== 'regular') continue
          const key = buildMakeupStockKey(resolveStudentKey(student), student.subject)
          const periods = periodsByKey[key] ?? []
          if (!periods.some((period) => cell.dateKey >= period.startDate && cell.dateKey <= period.endDate)) continue
          counts[key] = (counts[key] ?? 0) + 1
        }
      }
    }
  }

  return counts
}

// INV-06（2026-07-31・時限単位化）★消してはならないガード
//
// origin の同一性は「生徒 × 科目 × 日付 × **時限**」。内部では `YYYY-MM-DD#限` のトークンで扱う。
// 時限が分からない origin（旧データ／限を特定できない自動計算分）は `YYYY-MM-DD` のまま持ち、
// **同じ日付の時限つき origin と同一視する**（ワイルドカード）。
//
// なぜワイルドカードにするか（過大計上を防ぐ側に倒す）:
//   - 「5/25 の授業を休み」＋「その振替コマ(元コマ 5/25)も休み」は**同じ1コマ**なので合計1でなければならない。
//     時限が両方分かれば (5/25,4) 同士で一致して1になるが、片方の時限が不明なとき素直に別物として数えると
//     1コマの授業が2コマに増える（誤増＝INV-06 違反）。不明は既存 origin に吸収させる。
//   - 逆に「同じ日に同じ科目が2コマあり、両方休み」は (8/5,4) と (8/5,5) で別物＝2になる（誤減の解消）。
export type MakeupOriginRef = { dateKey: string; slotNumber?: number | null }

const ORIGIN_TOKEN_SEPARATOR = '#'

export function buildOriginToken(dateKey: string, slotNumber?: number | null) {
  return slotNumber ? `${dateKey}${ORIGIN_TOKEN_SEPARATOR}${slotNumber}` : dateKey
}

export function parseOriginToken(token: string): { dateKey: string; slotNumber: number | null } {
  const separatorIndex = token.indexOf(ORIGIN_TOKEN_SEPARATOR)
  if (separatorIndex < 0) return { dateKey: token, slotNumber: null }

  const slotNumber = Number(token.slice(separatorIndex + 1))
  return {
    dateKey: token.slice(0, separatorIndex),
    slotNumber: Number.isFinite(slotNumber) && slotNumber > 0 ? slotNumber : null,
  }
}

export function originTokenDateKey(token: string) {
  return parseOriginToken(token).dateKey
}

function toOriginTokens(origins: ManualMakeupOrigin[]) {
  return origins.map((origin) => buildOriginToken(origin.dateKey, origin.slotNumber))
}

function pushOrigin(originMap: OriginMap, key: string, token: string) {
  const nextTokens = originMap[key] ?? []
  originMap[key] = [...nextTokens, token].sort()
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

export function parseOriginSlotNumberFromLabel(label?: string) {
  const matched = String(label ?? '').match(/(\d+)限/)
  return matched ? Number(matched[1]) : null
}

/**
 * 「まだ振替コマが組まれていない休み」を 生徒×科目 ごとに算出する（盤面だけが根拠）。
 *
 * 生徒日程表の通常回数の括弧内（要実施数）＝ その期間の実績 ＋ その期間に属する未振替の休み、に使う。
 * オーナー確定の仕様（2026-08-05）「出欠記録が無ければ左と括弧は必ず一致する／休んで振替がまだなら
 * その分だけ括弧が多い／振替を表示期間外へ置いたら元の期間の括弧からも減る」を満たすための土台。
 *
 * ★**未消化在庫の台帳（manualMakeupAdjustments）も「今日」も学年度も使わない。**
 *   在庫は (a) 休日設定・格納・削除など由来の違うものが同じ器に混ざり区別できない、
 *   (b) `today = new Date()` と `resolveOperationalSchoolYear` に依存して増減する、
 *   (c) テンプレを曜日展開しただけで盤面に一度も存在しないコマを含む——の3点があり、
 *   これを括弧内の根拠にすると「操作していないのに日付が変わるだけで過去月が動く」
 *   「出欠を1件も付けていない生徒に警告が出る」が起きる（2026-08-05 の設計検証で確認）。
 *
 * 算出は多重集合の1対1消化で、既存の在庫算出と**同じ2段消化**（`consumeMatchingOriginTokens`）を共有する。
 *   義務(owed)   … status='absent' の記録。振無休(absent-no-makeup)は実績に数えるので義務にしない。
 *                   トークンは「元の通常授業日」＝ makeupSourceDate があればそれ、無ければそのコマの日付。
 *   消化(settled)… makeupSourceDate を持つコマ。**未出欠(studentSlots)と出欠済み(statusSlots)の両方を走査**する。
 *                   ★片方だけだと出席を付けた瞬間に消化が消え、振替済みの休みが未振替へ復活する
 *                     （INV-06 で繰り返し踏んでいる「両走査」規則と同じ）。
 *                   status='moved'（移動元マーカー）は移動先のコマが会計を持つので数えない。
 *                   休み(absent)の振替コマは**消化に数える**（同時に義務も1件立つので差し引き1件残る＝
 *                   「振替したがまた休んだ」を二重に数えないための要）。
 *   講習(special)と体験(trial)は対象外（講習の括弧内は提出データが正本・体験は日程表に載らない）。
 */
export function computeOutstandingAbsenceOrigins(params: {
  weeks: SlotCell[][]
  resolveStudentKey: (entry: Pick<StudentEntry, 'managedStudentId' | 'name'>) => string
}): Record<string, string[]> {
  const owed: OriginMap = {}
  const settled: OriginMap = {}
  const isCountedLessonType = (lessonType?: string | null) => lessonType !== 'special' && lessonType !== 'trial'

  for (const week of params.weeks) {
    for (const cell of week) {
      for (const desk of cell.desks) {
        for (const student of desk.lesson?.studentSlots ?? []) {
          if (!student || !isCountedLessonType(student.lessonType) || !student.makeupSourceDate) continue
          const key = buildMakeupStockKey(params.resolveStudentKey(student), student.subject)
          pushOrigin(settled, key, buildOriginToken(student.makeupSourceDate, parseOriginSlotNumberFromLabel(student.makeupSourceLabel)))
        }

        for (const statusEntry of desk.statusSlots ?? []) {
          if (!statusEntry || !isCountedLessonType(statusEntry.lessonType) || statusEntry.status === 'moved') continue
          const key = buildMakeupStockKey(params.resolveStudentKey(statusEntry), statusEntry.subject)

          // ★休み(absent)の振替コマは消化に数えない（実施していないため）。ここを数えると、
          //   別日へ移動した授業を休んだとき（元コマは moved で義務が立たない）に、同じ記録が
          //   義務と消化の両方へ積まれて相殺し、休んだ1コマが静かに消える
          //   （INV-06 の v1.5.459「moved-makeup-absence-loss」と同型の消滅）。
          if (statusEntry.makeupSourceDate && statusEntry.status !== 'absent') {
            pushOrigin(settled, key, buildOriginToken(statusEntry.makeupSourceDate, parseOriginSlotNumberFromLabel(statusEntry.makeupSourceLabel)))
          }

          if (statusEntry.status !== 'absent') continue
          const originToken = statusEntry.makeupSourceDate
            ? buildOriginToken(statusEntry.makeupSourceDate, parseOriginSlotNumberFromLabel(statusEntry.makeupSourceLabel))
            : buildOriginToken(cell.dateKey, cell.slotNumber)
          pushOrigin(owed, key, originToken)
        }
      }
    }
  }

  const outstanding: OriginMap = {}
  for (const [key, tokens] of Object.entries(owed)) {
    const remaining = consumeMatchingOriginTokens(dedupeOwedOriginTokens(tokens), settled[key] ?? [])
    if (remaining.length > 0) outstanding[key] = remaining
  }

  return outstanding
}

/**
 * 義務トークンの畳み込み。**同じ元コマを指す休みは何件あっても1件**にする。
 * 「7/1 を休み → 7/8 へ振替 → その 7/8 も休み」は、7/1 の授業1回が未実施なだけで義務は1件。
 * 畳まないと同じ1回を2件に数える（誤増）。
 * ★同じ日でも**時限が違えば別物**（7/1 の4限と5限を両方休んだら2件）。ここを日付だけで畳むと
 *   同日2コマ休みが1件に潰れて誤減する（2026-07-31 に在庫側で直した回帰と同型）。
 * 時限が判らないトークン（振替元ラベルが無い旧データ）は、同じ日の既存トークンへ吸収させる
 *   ＝過大計上しない側へ倒す（`consumeMatchingOriginTokens` の同日フォールバックと同じ考え方）。
 */
function dedupeOwedOriginTokens(tokens: string[]) {
  const kept: string[] = []

  for (const token of tokens) {
    const { dateKey, slotNumber } = parseOriginToken(token)
    const alreadyCovered = kept.some((existing) => {
      if (existing === token) return true
      if (originTokenDateKey(existing) !== dateKey) return false
      return slotNumber === null || parseOriginToken(existing).slotNumber === null
    })
    if (!alreadyCovered) kept.push(token)
  }

  return kept
}

// INV-06（未消化振替の消滅・2026-07-31 緑が丘校 報告）:
//
// 通常授業を別日へ「移動」しただけの振替コマは、台帳（自動休校日 / 同時間帯重複 / 手動調整）に
// origin を一切登録しない。盤面に置かれていること自体が唯一の記録で、消化(plannedMakeups)と
// 使用済み origin(usedOriginDates) が打ち消し合って残0になる、という均衡で成り立っている。
//
// このため、この振替コマを「休み」にすると
//   - 盤面からは消える（studentSlots → statusSlots(absent)）
//   - absent は消化に数えない（＝均衡が崩れる）が、戻すべき origin が台帳に無い
// ので、未消化振替へ1件も戻らず授業が丸ごと消滅していた（在庫由来の振替コマは台帳に origin が
// 残るので正しく戻り、同じ「休み」でも生徒によって結果が違う＝報告の「入らない生徒がいる」）。
//
// 出欠記録(absent)が盤面に残っている限り、その振替元日を origin として計上して復元する。
// 台帳へ書き戻さず**算出で復元**するのが要点:
//   - 休み解除で statusSlot が消えれば origin も自動的に消える（二重計上・非対称が起きない）
//   - 既に壊れている保存済みデータも、読み込み直しただけで復旧する（データ修復操作が不要）
// statusSlots を持つ週は trimBoardWeeksForMemory が必ず保持するため、算出元は失われない。
function collectAbsentMakeupOrigins(weeks: SlotCell[][], resolveStudentKey: (student: StudentEntry) => string) {
  const origins: OriginMap = {}

  for (const week of weeks) {
    for (const cell of week) {
      // ★非営業日(isOpenDay=false)のセルも走査する（2026-08-01・下流監査）。
      // 他の収集関数（countPlannedMakeupsByKey / collectMakeupUsageByKey）が非営業日を飛ばすのは
      // 「休日には授業が無い＝消化に数えない」ためだが、こちらは**消化ではなく在庫の根拠**を集める。
      // 出欠記録(absent)が残っているコマの日が、後から定休日・休日設定になった（＝盤面の中身は
      // 残ったまま isOpenDay だけ false になった）ときにここで飛ばすと、その1コマが在庫からも
      // 盤面からも消える（INV-06 誤減）。absent は消化側が必ず除外するので二重計上にはならない。
      for (const desk of cell.desks) {
        for (const statusEntry of desk.statusSlots ?? []) {
          if (!statusEntry) continue
          // ★手動追加コマ(manualAdded)も対象にする（2026-07-31 オーナー確定・例外を作らない）。
          // 日程表の実績カウントは manualAdded を除外しない＝手動追加した通常/振替/増コマも実績 +1 になる。
          // 休みにすれば実績から外れるので、在庫へ戻さないと1コマ消える（手動追加した振替コマを休みにすると
          // 台帳にも積まれず算出でも拾われず消滅していた）。消化(plannedMakeups)側が manualAdded を数えない
          // 非対称は仕様どおり（手動追加＝在庫を消費せずに足したコマ）で、その結果の在庫純増は許容する。
          // absent 限定。absent-no-makeup(振無休)は振替を出さない仕様、attended/moved は消化済み。
          if (statusEntry.status !== 'absent') continue
          if (statusEntry.lessonType !== 'makeup' || !statusEntry.makeupSourceDate) continue
          const studentLike = { ...statusEntry, id: statusEntry.studentId } as unknown as StudentEntry
          const key = buildMakeupStockKey(resolveStudentKey(studentLike), statusEntry.subject)
          // 時限は振替元ラベル（"7/29(水) 5限"）から復元する。取れなければ時限不明のまま積む
          // （＝同じ日付の他 origin と同一視されるので、二重計上にはならない）。
          const slotNumber = parseOriginSlotNumberFromLabel(statusEntry.makeupSourceLabel)
          pushOrigin(origins, key, buildOriginToken(statusEntry.makeupSourceDate, slotNumber))
        }
      }
    }
  }

  return origins
}

// 有効な未消化 origin を決める唯一の権威関数（分散させない）。入出力はいずれも origin トークン
// （`YYYY-MM-DD` または `YYYY-MM-DD#限`）。4 発生源の和集合から抑制分を除き、日付＋時限で一意にする。
//
// 抑制の当て方（2026-07-31 時限単位化）:
//   - 時限つきの抑制（新しく削除した分）… その (日付,時限) だけを落とす。同じ日の別コマは残る。
//   - 時限なしの抑制（旧データ・限を特定できない削除）… その日付を丸ごと落とす（従来どおり）。
// 最後に、同じ日付に時限つき origin があるときの「時限不明 origin」を落とす（同一コマの重複表現とみなす）。
export function resolveEffectiveMakeupOriginDates(params: {
  autoOriginDates: string[]
  conflictOriginDates: string[]
  manualOriginDates: string[]
  absentMakeupOriginDates: string[]
  suppressedOriginDates: string[]
}) {
  const { autoOriginDates, conflictOriginDates, manualOriginDates, absentMakeupOriginDates, suppressedOriginDates } = params

  const suppressedTokens = new Set(suppressedOriginDates)
  const suppressedWholeDates = new Set(
    suppressedOriginDates.filter((token) => parseOriginToken(token).slotNumber === null).map(originTokenDateKey),
  )

  const survivors = Array.from(new Set([...autoOriginDates, ...conflictOriginDates, ...manualOriginDates, ...absentMakeupOriginDates]))
    .filter((token) => !suppressedTokens.has(token) && !suppressedWholeDates.has(originTokenDateKey(token)))

  const datesWithKnownSlot = new Set(
    survivors.filter((token) => parseOriginToken(token).slotNumber !== null).map(originTokenDateKey),
  )

  return survivors
    .filter((token) => parseOriginToken(token).slotNumber !== null || !datesWithKnownSlot.has(originTokenDateKey(token)))
    .sort()
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
            pushOrigin(usedOriginDates, key, buildOriginToken(student.makeupSourceDate, parseOriginSlotNumberFromLabel(student.makeupSourceLabel)))
          }
        }
        for (const statusEntry of desk.statusSlots ?? []) {
          if (!statusEntry || statusEntry.manualAdded || statusEntry.lessonType !== 'makeup') continue
          if (statusEntry.status === 'absent') continue
          const studentLike = { ...statusEntry, id: statusEntry.studentId } as unknown as StudentEntry
          const key = buildMakeupStockKey(resolveStudentKey(studentLike), statusEntry.subject)
          counts[key] = (counts[key] ?? 0) + 1
          if (statusEntry.makeupSourceDate) {
            pushOrigin(usedOriginDates, key, buildOriginToken(statusEntry.makeupSourceDate, parseOriginSlotNumberFromLabel(statusEntry.makeupSourceLabel)))
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
  const currentSchoolYear = resolveOperationalSchoolYear(today)
  const studentById = new Map(students.map((student) => [student.id, student]))
  const shortages: OriginMap = {}
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
      const periodEndKey = stockPeriod.endDate
      if (periodEndKey < stockPeriod.startDate) continue
      const monthRange = iterateMonthsInRange(stockPeriod.startDate, periodEndKey)
      const student = studentById.get(participant.studentId)
      if (!student) continue

      const stockKey = buildMakeupStockKey(student.id, participant.subject)

      for (const { year, monthIndex } of monthRange) {
        // 休日設定した時点で即時に振替計上する(過去/未来問わず)。旧実装の「今日まで」制限は撤廃(spec-makeup-stock.md §1-A)。
        const scheduledDates = getScheduledDatesInMonth(year, monthIndex, row.dayOfWeek)
          .filter((dateKey) => dateKey >= stockPeriod.startDate && dateKey <= periodEndKey)
          .filter((dateKey) => isActiveOnDate(student.entryDate, student.withdrawDate, student.birthDate, dateKey))
        if (scheduledDates.length === 0) continue

        const openScheduledDates = scheduledDates.filter((dateKey) => !isClosedDate(dateKey, classroomSettings))
        const expectedLessonCount = scheduledDates.length
        const shortageCount = Math.max(0, expectedLessonCount - openScheduledDates.length)
        const missedDates = scheduledDates.filter((dateKey) => isClosedDate(dateKey, classroomSettings))
        const shortageDates = missedDates.slice(0, shortageCount)
        for (const shortageDate of shortageDates) {
          if (setupFloorKey && shortageDate < setupFloorKey) continue
          pushOrigin(shortages, stockKey, buildOriginToken(shortageDate, row.slotNumber))
        }
      }
    }
  }

  return { origins: shortages }
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
                isActiveOnDate(student.entryDate, student.withdrawDate, student.birthDate, dateKey)
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
          pushOrigin(conflicts, conflictKey, buildOriginToken(dateKey, originSlotNumber))
        }
        continue
      }

      if (row.teacherId) usedTeacherIds.add(row.teacherId)
      for (const participant of row.participants) {
        usedStudentIds.add(participant.studentId)
      }
    }
  }

  return { origins: conflicts }
}

// 消化の突き合わせ（トークン単位）。★消してはならないガード
// 完全一致（日付＋時限）を最優先し、一致しなければ**同じ日付の最初の origin** を消化する。
// 後者は「配置コマの振替元ラベルから時限が取れない（旧データ）」「時限が食い違う」ケースの受け皿で、
// これが無いと消化済みの振替が未消化として再出現する（誤増）。
// ★1件の使用が1件の origin だけを消す（多重集合の1対1消化）。ここを「同日ぜんぶ消す」に変えると、
//   同じ日に同じ科目が2コマある構成で1件の振替が2件を消し、未消化が過少になる。
export function consumeMatchingOriginTokens(originTokens: string[], usedTokens: string[]) {
  const remaining = [...originTokens]

  for (const usedToken of usedTokens) {
    let index = remaining.indexOf(usedToken)
    if (index < 0) {
      const usedDateKey = originTokenDateKey(usedToken)
      index = remaining.findIndex((token) => originTokenDateKey(token) === usedDateKey)
    }
    if (index >= 0) {
      remaining.splice(index, 1)
    }
  }

  return remaining
}

function consumeOriginDates(originDates: string[], usedOriginDates: string[], usedCount: number) {
  const remaining = consumeMatchingOriginTokens(originDates, usedOriginDates)

  // ★v1.5.78(`6829dd1`) のガード: origin と対応が取れない使用数のぶんを古い順に消す。
  // 消すと「配置済みなのに未消化として再出現する」二重計上が復活する。★消してはならない。
  let unassignedUseCount = Math.max(0, usedCount - usedOriginDates.length)
  while (unassignedUseCount > 0 && remaining.length > 0) {
    remaining.shift()
    unassignedUseCount -= 1
  }

  return remaining
}

// ある振替コマが「台帳に origin を持つ在庫由来」か「移動しただけで台帳未登録」かを、盤面の操作側から
// 判定するための有効 origin 一覧（key → 日付配列）。buildMakeupStockEntries と同じ発生源・同じ
// 権威関数(resolveEffectiveMakeupOriginDates)を使う＝判定が二重定義にならないようにする。
export function collectMakeupOriginDatesByKey(params: {
  students: StudentRow[]
  regularLessons: RegularLessonRow[]
  classroomSettings: ClassroomSettings
  weeks: SlotCell[][]
  manualAdjustments: Record<string, ManualMakeupOrigin[]>
  suppressedOrigins?: Record<string, ManualMakeupOrigin[]>
  resolveStudentKey: (student: StudentEntry) => string
  today?: Date
  /**
   * 「休み(absent)の出欠記録から算出で復元している origin」を含めるか（既定 true）。
   * ⚠️ **その出欠記録を破棄する操作**（休日設定）の側で「台帳に origin があるか」を判定するときは
   * false にする。true のまま使うと、算出で復元した自分自身を「台帳にある」と誤読して確定を取りやめ、
   * 記録の破棄と同時に在庫が消える（INV-06 誤減）。
   */
  includeAbsentMakeupOrigins?: boolean
}) {
  const { students, regularLessons, classroomSettings, weeks, manualAdjustments, suppressedOrigins = {}, resolveStudentKey, today = new Date(), includeAbsentMakeupOrigins = true } = params
  const managedStudentIds = new Set(students.map((student) => student.id))
  const automaticShortages = computeAutomaticShortageOrigins(regularLessons, students, classroomSettings, today).origins
  const conflictOrigins = computeScheduleConflictOrigins(regularLessons, students, classroomSettings, today).origins
  const absentMakeupOrigins = includeAbsentMakeupOrigins
    ? normalizeStringArrayMapKeys(collectAbsentMakeupOrigins(weeks, resolveStudentKey), managedStudentIds)
    : {}
  const normalizedManualAdjustments = normalizeMakeupOriginMapKeysByIdSet(manualAdjustments, managedStudentIds)
  const normalizedSuppressedOrigins = normalizeMakeupOriginMapKeysByIdSet(suppressedOrigins, managedStudentIds)

  const keys = new Set([
    ...Object.keys(automaticShortages),
    ...Object.keys(conflictOrigins),
    ...Object.keys(absentMakeupOrigins),
    ...Object.keys(normalizedManualAdjustments),
  ])

  return Array.from(keys).reduce<Record<string, string[]>>((accumulator, key) => {
    accumulator[key] = resolveEffectiveMakeupOriginDates({
      autoOriginDates: automaticShortages[key] ?? [],
      conflictOriginDates: conflictOrigins[key] ?? [],
      manualOriginDates: toOriginTokens(normalizedManualAdjustments[key] ?? []),
      absentMakeupOriginDates: absentMakeupOrigins[key] ?? [],
      suppressedOriginDates: toOriginTokens(normalizedSuppressedOrigins[key] ?? []),
    })
    return accumulator
  }, {})
}

// INV-06: 盤面から授業を外す操作（「未消化振替へ戻す」= 格納）で、台帳へ origin を積むべきか。
// - 通常授業 / 振替元日を持たないコマ … 従来どおり積む（元の通常授業日＝移動元があればそれ）。
// - 振替コマで**台帳に振替元日の origin がある**（在庫由来の振替） … 積まない。盤面から外れた時点で
//   その origin が未消化として再浮上するので、積むと二重計上になる。
// - 振替コマで**台帳に origin が無い**（通常授業を別日へ移動しただけの振替） … 積む。
//   盤面が唯一の記録なので、外した瞬間に授業が消滅する（休みでの消滅と同じ INV-06 違反）。
export function resolveStoreMakeupOriginDate(params: {
  student: Pick<StudentEntry, 'lessonType' | 'makeupSourceDate' | 'sameDayMoveSourceDate'>
  cellDateKey: string
  ledgerOriginDates: string[]
}): string | null {
  const { student, cellDateKey, ledgerOriginDates } = params
  const originDate = student.makeupSourceDate ?? student.sameDayMoveSourceDate ?? cellDateKey

  if (student.lessonType === 'regular' || !student.makeupSourceDate) return originDate
  return ledgerOriginsIncludeDate(ledgerOriginDates, student.makeupSourceDate) ? null : student.makeupSourceDate
}

// 台帳（collectMakeupOriginDatesByKey の戻り値）に、その振替元日の origin が既にあるか。
// ⚠️ 台帳側は時限つきトークン（`YYYY-MM-DD#限`）なのに、突き合わせる相手（statusEntry.makeupSourceDate /
// student.makeupSourceDate）は**日付だけ**。素の `includes` で比べると時限つき origin に当たらず
// 「台帳に無い」と誤判定して二重に積む（＝誤増）。**日付で突き合わせる**のが正しい
// （時限不明はワイルドカード＝過大計上しない側に倒す・2026-07-31 の時限単位化の方針と同じ）。
export function ledgerOriginsIncludeDate(ledgerOriginDates: string[], dateKey: string) {
  return ledgerOriginDates.some((token) => originTokenDateKey(token) === dateKey)
}

// INV-06: **振替コマの出欠記録を破棄する操作**（休日設定・その日の生徒を全コマ削除）で、
// その1コマを未消化振替へ返すときの元コマ判定。**振替コマの2種類で結果が食い違わないための唯一の関門**。
//
//   在庫由来（台帳に origin がある振替）… 盤面から外れれば台帳 origin が**自動で再浮上**する。
//                                        ここで積むと二重計上（誤増）になるので **null**。
//   移動由来（通常授業を別日へ移動しただけ・在庫を経由していない）… 盤面が唯一の記録なので、
//                                        **振替元日で積む**。積まないと1コマ消える（誤減）。
//
// ★元コマは必ず **振替元日**（`makeupSourceDate`）。当日（記録が載っているコマの日）で積んではいけない：
//   在庫由来は台帳の再浮上と合わせて二重計上になり、移動由来は同じ日の別 origin に吸収されて消える
//   （2026-08-02 の対称性監査で出席済みの振替コマに実在した非対称。在庫由来=残2／移動由来=残1）。
// - 通常授業 / 講習 / 振替元日を持たないコマ … null（mark 時に在庫会計済み・講習は講習在庫へ返す）。
// - 移動マーカー(moved) … null（会計は移動先のコマが持つ）。
// - 手動追加(manualAdded) … 在庫を消費していないので返す先が無く null。ただし **「休み」だけは例外的に返す**
//   （日程表の実績カウントが manualAdded を除外せず、休みにすると実績だけ −1 になって1コマ宙に浮くため。
//   spec-makeup-stock §B-3・2026-07-31 オーナー確定）。
export function resolveMakeupStatusOriginToMaterialize(params: {
  statusEntry: {
    status: string
    lessonType?: string | null
    makeupSourceDate?: string
    makeupSourceLabel?: string
    manualAdded?: boolean
  }
  ledgerOriginDates: string[]
}): { dateKey: string; slotNumber: number | null } | null {
  const { statusEntry, ledgerOriginDates } = params
  if (statusEntry.lessonType !== 'makeup' || !statusEntry.makeupSourceDate) return null
  if (statusEntry.status === 'moved') return null
  if (statusEntry.manualAdded && statusEntry.status !== 'absent') return null
  if (ledgerOriginsIncludeDate(ledgerOriginDates, statusEntry.makeupSourceDate)) return null
  return {
    dateKey: statusEntry.makeupSourceDate,
    slotNumber: parseOriginSlotNumberFromLabel(statusEntry.makeupSourceLabel),
  }
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
  // teachers はパラメータ型に残す(呼び出し側の互換維持)が、空きコマ不足origin廃止に伴い内部では未使用。
  const { students, regularLessons, classroomSettings, weeks, manualAdjustments, suppressedOrigins = {}, fallbackStudents = {}, resolveStudentKey, today = new Date() } = params
  const automaticShortageResult = computeAutomaticShortageOrigins(regularLessons, students, classroomSettings, today)
  const conflictResult = computeScheduleConflictOrigins(regularLessons, students, classroomSettings, today)
  const absentMakeupResultOrigins = collectAbsentMakeupOrigins(weeks, resolveStudentKey)
  const automaticShortages = automaticShortageResult.origins
  const conflictOrigins = conflictResult.origins
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
  const absentMakeupOrigins = normalizeStringArrayMapKeys(absentMakeupResultOrigins, managedStudentIds)
  const assignedRegularLessons = normalizeNumberMapKeys(countAssignedRegularLessonsByKey(weeks, resolveStudentKey, regularLessons), managedStudentIds)
  const totalLessonCounts = countTotalLessonQuotaByKey(regularLessons)
  const eligiblePlannedMakeupKeys = Object.keys(plannedMakeups)
  const trackedAssignedRegularKeys = Object.keys(assignedRegularLessons)
  const allKeys = new Set([...Object.keys(automaticShortages), ...Object.keys(conflictOrigins), ...Object.keys(normalizedManualAdjustments), ...Object.keys(absentMakeupOrigins), ...eligiblePlannedMakeupKeys, ...Object.keys(normalizedFallbackStudents), ...Object.keys(totalLessonCounts), ...trackedAssignedRegularKeys])

  const entries = Array.from(allKeys).map((key) => {
    const [studentKey, subject = ''] = key.split('__')
    const isManualEntry = studentKey.startsWith('manual:')
    const normalizedStudentKey = studentKey.replace(/^manual:/, '')
    const student = studentById.get(normalizedStudentKey) ?? null
    const fallback = normalizedFallbackStudents[key]
    const autoOriginDates = automaticShortages[key] ?? []
    const conflictOriginDates = conflictOrigins[key] ?? []
    const manualOrigins = normalizedManualAdjustments[key] ?? []
    const manualOriginDates = toOriginTokens(manualOrigins)
    const absentMakeupOriginDates = absentMakeupOrigins[key] ?? []
    const suppressedOriginDates = toOriginTokens(normalizedSuppressedOrigins[key] ?? [])
    // 理由ラベルは日付単位で持つ（同じ日に2コマあっても発生源の説明は同じ）。
    const manualOriginReasonLabels = manualOrigins.reduce<Record<string, string>>((accumulator, origin) => {
      if (!origin.reasonLabel || accumulator[origin.dateKey]) return accumulator
      accumulator[origin.dateKey] = origin.reasonLabel
      return accumulator
    }, {})
    const allOriginDates = resolveEffectiveMakeupOriginDates({
      autoOriginDates,
      conflictOriginDates,
      manualOriginDates,
      absentMakeupOriginDates,
      suppressedOriginDates,
    })
    const usedOriginDates = usedOriginDatesByKey[key] ?? []
    const plannedCount = plannedMakeups[key] ?? 0
    const assignedRegularCount = assignedRegularLessons[key] ?? 0
    const totalLessonCount = totalLessonCounts[key] ?? 0
    const overAssignedRegularLessons = totalLessonCount > 0
      ? Math.max(0, assignedRegularCount + plannedCount - totalLessonCount)
      : 0
    // トークン（日付＋時限）で消化し、外向きには日付と時限を別々の配列で返す。
    // `remainingOriginDates` は配置時に makeupSourceDate へそのまま渡るので**日付のみ**でなければならない。
    const remainingOriginTokens = consumeOriginDates(allOriginDates, usedOriginDates, plannedCount)
    const remainingOriginDates = remainingOriginTokens.map(originTokenDateKey)
    const remainingOriginSlots = remainingOriginTokens.map((token) => parseOriginToken(token).slotNumber)
    const remainingOriginLabels = buildOriginLabels(remainingOriginTokens, key, regularLessons)
    const remainingOriginReasonLabels = remainingOriginTokens.map((token) => resolveOriginReasonLabel(token, {
      classroomSettings,
      autoOriginDates,
      conflictOriginDates,
      manualOriginDates,
      absentMakeupOriginDates,
      manualOriginReasonLabels,
    }))
    const manualIndependentPlannedMakeups = isManualEntry ? Math.max(0, plannedCount - allOriginDates.length) : 0
    // マイナス残(過剰配置)表示は廃止。残数は consumeOriginDates が消化済みを除いた remainingOriginDates に一本化する。
    // overAssignedRegularLessons の減算は撤去(spec-makeup-stock.md §4 / §★3-C)。
    // 撤去理由(回帰防止): 振替を1コマ置くと plannedCount が増え、全通常授業を配置済みの生徒では
    //   assignedRegularCount + plannedCount > totalLessonCount となり overAssigned が +1 される。
    //   remainingOriginDates は既に1件消化されているため、この減算が重なると残が2件減って見える
    //   (3→1)バグになっていた。consumeOriginDates による消化だけで残数を表す。
    const balance = Math.max(0, remainingOriginTokens.length - manualIndependentPlannedMakeups)
    const negativeReason = null

    return {
      key,
      studentId: student?.id ?? null,
      studentName: student?.name ?? fallback?.studentName ?? normalizedStudentKey.replace(/^name:/, ''),
      displayName: student ? formatStudentSelectionLabel(student) : (fallback?.displayName ?? normalizedStudentKey.replace(/^name:/, '')),
      subject: student ? subject : (fallback?.subject ?? subject),
      balance,
      autoShortage: autoOriginDates.length + conflictOriginDates.length,
      absentMakeupOrigins: absentMakeupOriginDates.filter((token) => (
        !autoOriginDates.includes(token) && !conflictOriginDates.includes(token) && !manualOriginDates.includes(token)
      )).length,
      manualAdjustments: manualOriginDates.length,
      plannedMakeups: plannedCount,
      totalLessonCount,
      assignedRegularLessons: assignedRegularCount,
      assignedMakeupLessons: plannedCount,
      overAssignedRegularLessons,
      remainingOriginDates,
      remainingOriginSlots,
      remainingOriginLabels,
      remainingOriginReasonLabels,
      nextOriginDate: remainingOriginDates[0] ?? null,
      nextOriginSlot: remainingOriginSlots[0] ?? null,
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