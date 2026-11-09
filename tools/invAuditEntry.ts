// tools/inv-audit.mjs から esbuild で束ねて使うエントリ(テストは vitest で直接 import する)。
// 保証台帳 docs/spec-invariants.md に**違反している状態**を、1 教室の教室データ(AppSnapshotPayload)から洗い出す。
//
// ★方針(オーナー確定 2026-11-09)
//   - 「決めつけずに保証台帳に違反しているものがバグ」。判定はアプリの権威関数を呼ぶだけで、ここで規則を書き直さない
//     (同じコマの重複＝findDuplicateStudentInCellByKey・在庫＝buildMakeupStockEntries / buildLectureStockEntries・
//      根拠を失った振替＝collectOrphanedMakeups・講師日程表の帰属＝buildTeacherPayload → buildTeacherAssignments・
//      写しトークン＝isParentPortalTokenOwnedByClassroom / isSubmissionTokenOwnedByClassroom)。
//   - 休日に設定した日に残る**授業**もバグとして出す(オーナー指示)。出欠記録(休み・振無休・移動・休))は授業ではない。
//   - 読み取り専用。ネットワークにもファイルにも触れない(入力は呼び出し側が渡した payload だけ)。
//   - 結果に生徒名・講師名を入れない(生徒・講師は ID だけ)。名前は CLI の --show-names が名簿から添える。
import {
  applyClassroomAvailability,
  buildTemplateDiffTemplateCells,
  findDuplicateStudentInCellByKey,
} from '../src/components/schedule-board/ScheduleBoardScreen'
import { getStudentDisplayName, type StudentRow, type TeacherRow } from '../src/components/basic-data/basicDataModel'
import type { RegularLessonRow } from '../src/components/basic-data/regularLessonModel'
import { buildMakeupStockEntries, collectMakeupOriginDatesByKey, type ManualMakeupOrigin } from '../src/components/schedule-board/makeupStock'
import { buildLectureStockEntries, buildLectureStockKey, parseLectureStockKey } from '../src/components/schedule-board/lectureStock'
import { collectOrphanedMakeups } from '../src/components/schedule-board/templateTransferFollow'
import { normalizeTemplatePendingDeskMap, parseTemplatePendingDeskKey } from '../src/components/schedule-board/templatePendingDesks'
import type { DeskCell, SlotCell, StudentEntry } from '../src/components/schedule-board/types'
import type { SpecialSessionRow } from '../src/components/special-data/specialSessionModel'
import type { AppSnapshotPayload, ClassroomSettings } from '../src/types/appState'
import { isParentPortalTokenOwnedByClassroom, isSubmissionTokenOwnedByClassroom } from '../src/utils/developmentClassroom'
import { buildTeacherPayload } from '../src/utils/scheduleHtml'
import { buildTeacherAssignments, collectTeacherAssignmentEntries, isVisibleInRange, type TeacherScheduleEntry } from '../src/utils/scheduleViewData'

/** 出力の並び順もこの順(今日以降 → 今日より前、の中でこの順)。 */
export const INV_AUDIT_RULES = ['INV-12', 'INV-06', 'HOLIDAY', 'INV-01', 'INV-13', 'INV-08', 'INV-14'] as const
export type InvAuditRule = (typeof INV_AUDIT_RULES)[number]

export type InvAuditFinding = {
  rule: InvAuditRule
  /** bug＝保証文の違反(またはオーナーがバグと決めたもの)。check＝違反とは言い切れないが人が見るもの。 */
  severity: 'bug' | 'check'
  /** ルールの中の種類(例: orphaned-makeup・lecture-overconsumed・empty-students)。 */
  kind: string
  studentId: string | null
  dateKey?: string
  slotNumber?: number
  /** 机の番号(0 始まり。メッセージでは「机1」から数える)。 */
  deskIndex?: number
  /** 科目(在庫・振替・休日の授業の所見)。既知の突き合わせに使える。 */
  subject?: string
  /** 講習 ID(未消化講習の所見)。既知の突き合わせに使える。 */
  sessionId?: string
  /**
   * future＝今日以降の日付(日付の無い所見＝今の教室データの状態も含む)／past＝今日より前の日付。
   * 未消化講習の所見は講習の終わりの日(session.endDate)で決める(終わった講習の台帳だけの跡は past)。
   */
  period: 'future' | 'past'
  /** 日本語の 1 行。生徒・講師は ID だけ。 */
  message: string
}

/**
 * 既知の除外。rule・classroomId・studentId・dateKey・slotNumber は一致が必要(dateKey・slotNumber は無い所見なら書かない)。
 * kind・subject・sessionId は書いたときだけ一致を要求する(日付の無い所見＝在庫・トークンを 1 件に絞るため)。
 */
export type KnownIssue = { rule?: string; kind?: string; classroomId?: string; dateKey?: string; slotNumber?: number; studentId?: string; subject?: string; sessionId?: string; note?: string }

export type InvAuditResult = {
  findings: InvAuditFinding[]
  /**
   * `<rule>`・`<rule>.future`・`<rule>.past`(bug と check の合計)、`<rule>.bug`・`<rule>.bug.future`・`<rule>.check`・`<rule>.check.future`
   * (全ルール 0 を含む)と total・bug・check・known(既知で除いた数)。**違反は bug だけ**(check は要確認)。
   */
  counts: Record<string, number>
  /** 調べられなかったルールとその理由など。 */
  notes: string[]
}

const WHOLE_DAY_PAIR_PREFIX = 'WHOLE_DAY_PAIR__'
const NO_STUDENT_ID = '(生徒ID なし)'

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

function normalizeWeeks(value: unknown): SlotCell[][] {
  return asArray<unknown>(value).map((week) => {
    if (Array.isArray(week)) return week as SlotCell[]
    return isPlainObject(week) && Array.isArray(week.cells) ? (week.cells as SlotCell[]) : []
  })
}

/** 教室設定が欠けていても他のルールが落ちないよう、配列と机の数だけ補う(欠けそのものは INV-14 で出す)。 */
function normalizeSettings(value: unknown, weeks: SlotCell[][]): ClassroomSettings {
  const raw = isPlainObject(value) ? value : {}
  const maxDesks = weeks.reduce((max, week) => week.reduce((inner, cell) => Math.max(inner, asArray(cell?.desks).length), max), 0)
  return {
    ...(raw as Partial<ClassroomSettings>),
    closedWeekdays: asArray<number>(raw.closedWeekdays),
    holidayDates: asArray<string>(raw.holidayDates),
    forceOpenDates: asArray<string>(raw.forceOpenDates),
    deskCount: typeof raw.deskCount === 'number' && raw.deskCount > 0 ? raw.deskCount : Math.max(1, maxDesks),
  } as ClassroomSettings
}

function parseTodayDate(today: string) {
  const parsed = new Date(`${today}T00:00:00`)
  return Number.isNaN(parsed.getTime()) ? new Date() : parsed
}

export function auditClassroomSnapshot(input: {
  classroomId: string
  payload: AppSnapshotPayload
  /** YYYY-MM-DD。これより前の日付の所見は past に数える。 */
  today: string
  known?: KnownIssue[]
}): InvAuditResult {
  const { classroomId, today } = input
  const payload = (isPlainObject(input.payload) ? input.payload : {}) as Partial<AppSnapshotPayload>
  const boardState = isPlainObject(payload.boardState) ? payload.boardState : null
  const rawWeeks = normalizeWeeks(boardState?.weeks)
  const classroomSettings = normalizeSettings(payload.classroomSettings, rawWeeks)
  const students = asArray<StudentRow>(payload.students)
  const teachers = asArray<TeacherRow>(payload.teachers)
  const regularLessons = asArray<RegularLessonRow>(payload.regularLessons)
  const specialSessions = asArray<SpecialSessionRow>(payload.specialSessions)
  // 盤面画面の normalizedWeeks と同じ(机の数・開校日)。
  const weeks = applyClassroomAvailability(rawWeeks, classroomSettings)
  const cells = weeks.flat()
  const cellById = new Map(cells.map((cell) => [cell.id, cell]))
  const suppressed = asArray<string>(boardState?.suppressedRegularLessonOccurrences)
  const wholeDayPairKeys = suppressed.filter((key) => typeof key === 'string' && key.startsWith(WHOLE_DAY_PAIR_PREFIX))
  const templatePendingDesks = normalizeTemplatePendingDeskMap(boardState?.templatePendingDesks)
  const manualMakeupAdjustments = (isPlainObject(boardState?.manualMakeupAdjustments) ? boardState.manualMakeupAdjustments : {}) as Record<string, ManualMakeupOrigin[]>
  const suppressedMakeupOrigins = (isPlainObject(boardState?.suppressedMakeupOrigins) ? boardState.suppressedMakeupOrigins : {}) as Record<string, ManualMakeupOrigin[]>
  const todayDate = parseTodayDate(today)

  // 盤面画面の managedStudentByAnyName / managedStudentNameMap と同じ作り方(登録名・表示名の両方を引く・vanishedMakeupReportEntry と同じ)。
  const studentByAnyName = new Map<string, StudentRow>()
  const displayNameByAnyName = new Map<string, string>()
  for (const student of students) {
    const displayName = getStudentDisplayName(student)
    studentByAnyName.set(student.name, student)
    studentByAnyName.set(displayName, student)
    displayNameByAnyName.set(student.name, displayName)
    displayNameByAnyName.set(displayName, displayName)
  }
  const resolveManagedId = (student: Pick<StudentEntry, 'managedStudentId' | 'name'>) => student.managedStudentId ?? studentByAnyName.get(student.name)?.id ?? null
  // 盤面の resolveStockComparableStudentKey と同じ(重複検査の鍵)。
  const resolveComparableKey = (student: StudentEntry) => resolveManagedId(student) ?? `name:${displayNameByAnyName.get(student.name) ?? student.name}`
  // 盤面の resolveBoardStudentStockId と同じ(在庫の鍵)。
  const resolveStockKey = (student: StudentEntry) => {
    const managedId = resolveManagedId(student)
    if (managedId) return managedId
    const fallbackId = `name:${displayNameByAnyName.get(student.name) ?? student.name}`
    return student.manualAdded ? `manual:${fallbackId}` : fallbackId
  }

  const findings: InvAuditFinding[] = []
  const notes: string[] = []
  /** periodDateKey: 期間を決める日付(省略時は dateKey)。 */
  const push = (finding: Omit<InvAuditFinding, 'period'>, periodDateKey: string | undefined = finding.dateKey) => {
    findings.push({ ...finding, period: periodDateKey && periodDateKey < today ? 'past' : 'future' })
  }
  const desk = (deskIndex: number) => `机${deskIndex + 1}`
  const sid = (studentId: string | null | undefined) => studentId || NO_STUDENT_ID

  // ── INV-12 同じコマ(日付×時限)に同じ生徒が 2 か所以上(上段＝盤面の週だけ。保留の下段は配置ではない・INV-12 注記) ──
  for (const cell of cells) {
    const groups = new Map<string, { studentId: string | null; deskIndexes: number[] }>()
    cell.desks.forEach((currentDesk, deskIndex) => {
      ;(currentDesk.lesson?.studentSlots ?? []).forEach((student, studentIndex) => {
        if (!student) return
        const key = resolveComparableKey(student)
        if (!findDuplicateStudentInCellByKey(cell, key, resolveComparableKey, [], [{ deskIndex, studentIndex }])) return
        const group = groups.get(key) ?? { studentId: resolveManagedId(student), deskIndexes: [] }
        group.deskIndexes.push(deskIndex)
        groups.set(key, group)
      })
    })
    for (const group of groups.values()) {
      push({
        rule: 'INV-12', severity: 'bug', kind: 'duplicate-placement', studentId: group.studentId, dateKey: cell.dateKey, slotNumber: cell.slotNumber, deskIndex: group.deskIndexes[0],
        message: `同じコマに同じ生徒が ${group.deskIndexes.length} か所: ${cell.dateKey} ${cell.slotNumber}限 ${group.deskIndexes.map(desk).join('・')} ${sid(group.studentId)}`,
      })
    }
  }

  // ── INV-06 在庫が負(未消化振替の残・未消化講習の残) ──
  const makeupEntries = buildMakeupStockEntries({
    students, teachers, regularLessons, classroomSettings, weeks,
    manualAdjustments: manualMakeupAdjustments,
    suppressedOrigins: suppressedMakeupOrigins,
    fallbackStudents: (isPlainObject(boardState?.fallbackMakeupStudents) ? boardState.fallbackMakeupStudents : {}) as Record<string, { studentName: string; displayName: string; subject: string }>,
    resolveStudentKey: resolveStockKey,
    today: todayDate,
    templatePendingDesks,
    wholeDayPairKeys,
  })
  // 未消化振替の残(balance)はアプリが 0 を下限にしている(spec-makeup-stock §4「マイナス残廃止」)。ここは下限が外れたときの番人で、
  // 今の作りでは出ない。振替元の根拠が無い振替(＝実質の過剰消化)は下の collectOrphanedMakeups で見る。
  for (const entry of makeupEntries) {
    if (entry.balance >= 0) continue
    push({ rule: 'INV-06', severity: 'bug', kind: 'makeup-negative', studentId: entry.studentId, subject: entry.subject, message: `未消化振替の残が負: ${sid(entry.studentId)} ${entry.subject} 残 ${entry.balance}` })
  }
  // 講習の残は「提出の希望数 − 台帳の消化」。アプリは 0 で止めて表示する(buildLecturePendingItemsByEntryKey)ので、止める前の値で見る。
  const requestedByStockKey = new Map<string, number>()
  for (const entry of buildLectureStockEntries({ specialSessions, students })) {
    const stockKey = buildLectureStockKey(entry.studentId, entry.subject, entry.sessionId)
    requestedByStockKey.set(stockKey, (requestedByStockKey.get(stockKey) ?? 0) + entry.requestedCount)
  }
  const lectureCounts = (isPlainObject(boardState?.manualLectureStockCounts) ? boardState.manualLectureStockCounts : {}) as Record<string, number>
  for (const [stockKey, delta] of Object.entries(lectureCounts)) {
    if (typeof delta !== 'number' || delta >= 0) continue
    const requested = requestedByStockKey.get(stockKey) ?? 0
    const remaining = requested + delta
    if (remaining >= 0) continue
    const { studentKey, subject, sessionId } = parseLectureStockKey(stockKey)
    const studentId = /^(name|manual):/.test(studentKey) ? null : studentKey
    // 日付は講習の終わりの日で決める(終わった講習の台帳だけの跡を「今日以降」に数えない)。講習が無い・見つからないなら今の状態＝今日以降。
    const sessionEndDate = sessionId ? specialSessions.find((session) => session?.id === sessionId)?.endDate : undefined
    push({
      rule: 'INV-06', severity: 'check', kind: 'lecture-overconsumed', studentId, subject, ...(sessionId ? { sessionId } : {}),
      // 「台帳の差分」は manualLectureStockCounts の値(負＝消化の記録)。盤面に置いたコマ数とは別物。
      message: `未消化講習の台帳の差分が提出の希望数を超えている: ${sid(studentId)} ${subject} 講習 ${sessionId ?? '(講習なし)'}${sessionEndDate ? `(〜${sessionEndDate})` : ''} 希望 ${requested}・台帳の差分 ${delta}(残 ${remaining}・画面は 0 と表示)`,
    }, sessionEndDate || undefined)
  }

  // ── INV-06 根拠を失った振替(collectOrphanedMakeups・テンプレの反映日以降の振替元だけ) ──
  const effectiveStartDate = classroomSettings.regularLessonTemplate?.effectiveStartDate ?? ''
  if (!effectiveStartDate) {
    notes.push('INV-06 根拠を失った振替: テンプレの反映日(regularLessonTemplate.effectiveStartDate)が無いので調べていません。')
  } else {
    const templateCells = buildTemplateDiffTemplateCells({ weeks: rawWeeks, classroomSettings, teachers, students, regularLessons, effectiveStartDate, suppressedRegularLessonOccurrences: suppressed })
    const orphaned = collectOrphanedMakeups({
      weeks, templateCells, regularLessons, manualMakeupAdjustments,
      resolveLedgerOriginDates: (ledgerAfterRemovals) => collectMakeupOriginDatesByKey({
        students, regularLessons, classroomSettings, weeks,
        manualAdjustments: ledgerAfterRemovals, suppressedOrigins: suppressedMakeupOrigins, resolveStudentKey: resolveStockKey,
        today: todayDate, includeAbsentMakeupOrigins: true, templatePendingDesks, wholeDayPairKeys,
      }),
      effectiveStartDate, slotFilter: null, pendingDesks: templatePendingDesks,
    })
    for (const removal of orphaned.removals) {
      const cell = cellById.get(removal.cellId)
      const deskIndex = cell ? cell.desks.findIndex((item) => item.id === removal.deskId) : -1
      const slotNumber = cell?.slotNumber
      const studentId = removal.student.managedStudentId ?? null
      push({
        rule: 'INV-06', severity: 'bug', kind: 'orphaned-makeup', studentId, subject: removal.student.subject, dateKey: removal.targetDateKey, slotNumber, ...(deskIndex >= 0 ? { deskIndex } : {}),
        message: `根拠を失った振替: ${removal.targetDateKey} ${slotNumber ?? '?'}限 ${deskIndex >= 0 ? desk(deskIndex) : '机?'}${removal.inLower ? '(保留の下段)' : ''} ${sid(studentId)} ${removal.student.subject} 振替元 ${removal.sourceDateKey}${removal.sourceSlotNumber ? ` ${removal.sourceSlotNumber}限` : ''}(振替元の日にテンプレの授業も在庫の元コマも無い)`,
      })
    }
  }

  // ── HOLIDAY 休日(holidayDates・forceOpenDates で開けた日は除く＝盤面と同じ開校日の判定)に授業が残っている ──
  // 授業＝机の lesson.studentSlots の生徒。出欠記録(statusSlots の休み・振無休・移動・休))は記録なので数えない。
  const holidayDates = new Set(classroomSettings.holidayDates)
  for (const cell of cells) {
    if (!holidayDates.has(cell.dateKey) || cell.isOpenDay) continue
    cell.desks.forEach((currentDesk, deskIndex) => {
      for (const student of currentDesk.lesson?.studentSlots ?? []) {
        if (!student) continue
        const studentId = resolveManagedId(student)
        push({
          rule: 'HOLIDAY', severity: 'bug', kind: 'holiday-lesson', studentId, subject: student.subject, dateKey: cell.dateKey, slotNumber: cell.slotNumber, deskIndex,
          message: `休日に授業が残っている: ${cell.dateKey} ${cell.slotNumber}限 ${desk(deskIndex)} ${sid(studentId)} ${student.lessonType} ${student.subject}`,
        })
      }
    })
  }

  // ── INV-01 / INV-13: 講師日程表の材料(アプリと同じ buildTeacherPayload。日程表は盤面の写し＝盤面の週をそのまま渡す) ──
  if (cells.length > 0) {
    const sortedDates = cells.map((cell) => cell.dateKey).sort()
    const teacherPayload = buildTeacherPayload({
      cells,
      teachers,
      students,
      regularLessons,
      regularLessonTemplateHistory: classroomSettings.regularLessonTemplateHistory,
      preTemplateRegularLessons: classroomSettings.preTemplateRegularLessons,
      defaultStartDate: sortedDates[0],
      defaultEndDate: sortedDates[sortedDates.length - 1],
      titleLabel: '',
      classroomSettings,
      classroomStorageKey: classroomId,
      classroomName: '',
      periodBands: specialSessions,
      specialSessions,
      lazyQrLoading: true,
      showSubmittedQr: false,
    })
    const findDeskIndex = (dateKey: string, slotNumber: number, entryId: string) => {
      const cell = cells.find((item) => item.dateKey === dateKey && item.slotNumber === slotNumber)
      if (!cell) return -1
      return cell.desks.findIndex((item: DeskCell) => (
        (item.lesson?.studentSlots ?? []).some((student) => student?.id === entryId)
        || (item.statusSlots ?? []).some((status) => status?.id === entryId)
      ))
    }

    // INV-01: 1 つの机(講師日程表の 1 行)が 2 人以上の講師のページに出る。
    // 講師日程表はその期間に在籍していない講師を一覧に出さない(getVisibleTeachers → isVisibleInRange)ので、そのコマの日で在籍していない講師は数えない。
    const assignments = buildTeacherAssignments(teacherPayload.cells)
    const holders = new Map<TeacherScheduleEntry, string[]>()
    for (const teacher of teacherPayload.teachers) {
      for (const entry of collectTeacherAssignmentEntries(assignments, teacher)) {
        if (!isVisibleInRange(teacher, entry.dateKey, entry.dateKey, today)) continue
        const list = holders.get(entry) ?? []
        if (!list.includes(teacher.id)) list.push(teacher.id)
        holders.set(entry, list)
      }
    }
    for (const [entry, teacherIds] of holders) {
      if (teacherIds.length < 2) continue
      const people = [
        ...(entry.students ?? []).map((student) => ({ id: student.id, studentId: student.linkedStudentId ?? null })),
        ...(entry.statuses ?? []).map((status) => ({ id: status.id, studentId: status.linkedStudentId ?? null })),
      ]
      for (const person of people) {
        const deskIndex = findDeskIndex(entry.dateKey, entry.slotNumber, person.id)
        push({
          rule: 'INV-01', severity: 'bug', kind: 'teacher-double-display', studentId: person.studentId, dateKey: entry.dateKey, slotNumber: entry.slotNumber, ...(deskIndex >= 0 ? { deskIndex } : {}),
          message: `講師日程表で ${teacherIds.length} 人の講師に出る: ${entry.dateKey} ${entry.slotNumber}限 ${deskIndex >= 0 ? desk(deskIndex) : '机?'} ${sid(person.studentId)} 講師 ${teacherIds.join('・')}`,
        })
      }
    }

    // INV-13: 保留の下段の授業(同じ授業 ID)が、同じコマの日程表の材料にも入っている。
    const payloadEntryIdsBySlot = new Map<string, Set<string>>()
    for (const cell of teacherPayload.cells) {
      const ids = payloadEntryIdsBySlot.get(`${cell.dateKey}#${cell.slotNumber}`) ?? new Set<string>()
      for (const item of cell.desks) for (const student of item.lesson?.students ?? []) ids.add(student.id)
      payloadEntryIdsBySlot.set(`${cell.dateKey}#${cell.slotNumber}`, ids)
    }
    for (const [key, pending] of Object.entries(templatePendingDesks)) {
      const parsed = parseTemplatePendingDeskKey(key)
      const cell = parsed ? cellById.get(parsed.cellId) : undefined
      if (!parsed || !cell) continue
      const ids = payloadEntryIdsBySlot.get(`${cell.dateKey}#${cell.slotNumber}`)
      const deskIndex = cell.desks.findIndex((item) => item.id === parsed.deskId)
      for (const student of pending.lower.lesson?.studentSlots ?? []) {
        if (!student || !ids?.has(student.id)) continue
        const studentId = resolveManagedId(student)
        push({
          rule: 'INV-13', severity: 'bug', kind: 'pending-lower-in-schedule', studentId, dateKey: cell.dateKey, slotNumber: cell.slotNumber, ...(deskIndex >= 0 ? { deskIndex } : {}),
          message: `保留の下段の授業が日程表にも出ている: ${cell.dateKey} ${cell.slotNumber}限 ${deskIndex >= 0 ? desk(deskIndex) : '机?'} ${sid(studentId)}`,
        })
      }
    }
  }

  // ── INV-08 写しトークンの発行元教室タグが開いている教室と違う(値は出さない) ──
  for (const student of students) {
    if (!student?.parentPortalToken || isParentPortalTokenOwnedByClassroom(student, classroomId)) continue
    const tag = student.parentPortalTokenClassroomId
    if (tag) {
      push({ rule: 'INV-08', severity: 'bug', kind: 'parent-portal-token-foreign', studentId: student.id, message: `保護者QRの写しトークンが別の教室のもの: ${student.id} 発行元 ${tag}` })
    } else {
      push({ rule: 'INV-08', severity: 'check', kind: 'parent-portal-token-untagged', studentId: student.id, message: `保護者QRの写しトークンに発行元の教室が無い: ${student.id}` })
    }
  }
  // 講習の提出トークン: タグの無い既存トークンは本番教室で正常(タグは開発用教室の混入防止で付けた)。タグが別教室のものだけ出す。
  for (const session of specialSessions) {
    for (const [studentId, studentInput] of Object.entries(isPlainObject(session?.studentInputs) ? session.studentInputs : {})) {
      if (!studentInput?.submissionToken || !studentInput.submissionTokenClassroomId || isSubmissionTokenOwnedByClassroom(studentInput, classroomId)) continue
      push({ rule: 'INV-08', severity: 'bug', kind: 'submission-token-foreign', studentId, message: `講習の提出トークンが別の教室のもの: 講習 ${session.id} 生徒 ${studentId} 発行元 ${studentInput.submissionTokenClassroomId}` })
    }
  }
  for (const session of specialSessions) {
    for (const [teacherId, teacherInput] of Object.entries(isPlainObject(session?.teacherInputs) ? session.teacherInputs : {})) {
      if (!teacherInput?.submissionToken || !teacherInput.submissionTokenClassroomId || isSubmissionTokenOwnedByClassroom(teacherInput, classroomId)) continue
      push({ rule: 'INV-08', severity: 'bug', kind: 'submission-token-foreign', studentId: null, message: `講習の提出トークンが別の教室のもの: 講習 ${session.id} 講師 ${teacherId} 発行元 ${teacherInput.submissionTokenClassroomId}` })
    }
  }

  // ── INV-14 教室データの欠け(名簿・講師・教室設定・盤面の週) ──
  if (students.length === 0) push({ rule: 'INV-14', severity: 'check', kind: 'empty-students', studentId: null, message: '名簿(生徒)が 0 件' })
  if (teachers.length === 0) push({ rule: 'INV-14', severity: 'check', kind: 'empty-teachers', studentId: null, message: '講師が 0 件' })
  if (!isPlainObject(payload.classroomSettings)) push({ rule: 'INV-14', severity: 'check', kind: 'missing-classroom-settings', studentId: null, message: '教室設定(classroomSettings)が無い' })
  if (cells.length === 0) push({ rule: 'INV-14', severity: 'check', kind: 'empty-weeks', studentId: null, message: '盤面の週(boardState.weeks)が 0 件' })

  // ── 既知を除き、並べ、数える ──
  const knownIssues = asArray<KnownIssue>(input.known).filter((issue): issue is KnownIssue => isPlainObject(issue))
    .filter((issue) => issue.classroomId === classroomId && typeof issue.rule === 'string' && issue.studentId)
  const optionalMatches = (expected: string | undefined, actual: string | undefined) => expected === undefined || expected === actual
  const isKnown = (finding: InvAuditFinding) => Boolean(finding.studentId) && knownIssues.some((issue) => (
    issue.rule === finding.rule
    && issue.studentId === finding.studentId
    && (issue.dateKey ?? undefined) === finding.dateKey
    && (issue.slotNumber == null ? finding.slotNumber == null : Number(issue.slotNumber) === finding.slotNumber)
    && optionalMatches(issue.kind, finding.kind)
    && optionalMatches(issue.subject, finding.subject)
    && optionalMatches(issue.sessionId, finding.sessionId)
  ))
  let knownSkipped = 0
  const kept = findings.filter((finding) => {
    if (isKnown(finding)) {
      knownSkipped += 1
      return false
    }
    return true
  })
  const ruleOrder = new Map(INV_AUDIT_RULES.map((rule, index) => [rule, index]))
  const sorted = kept
    .map((finding, index) => ({ finding, index }))
    .sort((left, right) => (
      (left.finding.period === right.finding.period ? 0 : left.finding.period === 'future' ? -1 : 1)
      || (ruleOrder.get(left.finding.rule)! - ruleOrder.get(right.finding.rule)!)
      || (left.finding.dateKey ?? '').localeCompare(right.finding.dateKey ?? '')
      || (left.finding.slotNumber ?? 0) - (right.finding.slotNumber ?? 0)
      || (left.finding.deskIndex ?? -1) - (right.finding.deskIndex ?? -1)
      || left.index - right.index
    ))
    .map(({ finding }) => finding)

  const counts: Record<string, number> = { total: sorted.length, bug: 0, check: 0, known: knownSkipped }
  for (const rule of INV_AUDIT_RULES) {
    for (const suffix of ['', '.future', '.past', '.bug', '.bug.future', '.check', '.check.future']) counts[`${rule}${suffix}`] = 0
  }
  for (const finding of sorted) {
    counts[finding.severity] += 1
    counts[finding.rule] += 1
    counts[`${finding.rule}.${finding.period}`] += 1
    counts[`${finding.rule}.${finding.severity}`] += 1
    if (finding.period === 'future') counts[`${finding.rule}.${finding.severity}.future`] += 1
  }
  return { findings: sorted, counts, notes }
}
