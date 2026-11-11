// 画面の自動巡回(tools/ui-patrol.mjs・台本 h「講習の自動割振」・2026-11-11 第 2 段の 5 本目・既定では流さない)の候補選びと、置いた席の決まりの点検。
// 入口は盤面の「未消化講習」→ 生徒の行 → 自動割振(「未消化振替も同時に自動割り当てする」の選択つき)＝ScheduleBoardScreen.tsx の
// handleAutoAssignLectureStockEntry(講習)と findBestMakeupAutoAssignCandidate(振替・同じ講習の期間)。全員まとめての入口は無い(生徒の行ごと)。
// ★数え方・決まりはアプリの権威関数をそのまま使う(道具の側に別の判定を作らない):
//   在庫＝stock.ts(buildLecturePendingItemsByEntryKey・buildMakeupStockEntries)・出席不可＝resolveEffectiveUnavailableSlots・
//   制約事項の対象と区分＝isAutoAssignRuleApplicable・isSubjectCapabilityConstraintApplicable・resolveRuleCategory・resolveForbiddenPeriods・
//   科目対応＝canTeacherHandleStudentSubject・在籍＝isActiveOnDate。学年は、アプリが置いた生徒に付けた grade(置いた日の学年)を読む。
// ★確かめられない制約事項(通常講師のみ＝盤面とライブ配列の担当講師の和・1 日のコマ数の上限＝同じ日の授業の数え方)は止めずに注へ出す(runbook の限界)。
// ★純関数。入力を書き換えない。ネットワークにもファイルにも触れない。
import { canTeacherHandleStudentSubject, isAutoAssignRuleApplicable, isSubjectCapabilityConstraintApplicable } from '../../src/components/schedule-board/ScheduleBoardScreen'
import { resolveForbiddenPeriods, resolveRuleCategory, type AutoAssignRuleKey, type AutoAssignRuleRow } from '../../src/components/auto-assign-rules/autoAssignRuleModel'
import { isActiveOnDate, type StudentRow, type TeacherRow } from '../../src/components/basic-data/basicDataModel'
import { resolveEffectiveUnavailableSlots, type SpecialSessionRow } from '../../src/components/special-data/specialSessionModel'
import type { GradeLabel, SlotCell, SubjectLabel } from '../../src/components/schedule-board/types'
import type { AppSnapshotPayload } from '../../src/types/appState'
import type { AutoAssignPlacement, PatrolFinding } from './checks'
import type { StockBalances } from './stock'

/** 台本 h の操作の並び(この順に流す)。1 回目は講習だけ、2 回目は「未消化振替も同時に自動割り当てする」を入れて別の生徒。 */
export const AUTO_ASSIGN_OPS = [
  { name: 'lecture-only', includeMakeup: false, label: '講習の自動割振(講習だけ)' },
  { name: 'with-makeup', includeMakeup: true, label: '講習の自動割振(未消化振替も同時に)' },
] as const

export type AutoAssignPlanOp = {
  name: (typeof AUTO_ASSIGN_OPS)[number]['name']
  label: string
  includeMakeup: boolean
  entryKey: string
  studentKey: string
  sessionId: string
  periodStart: string
  periodEnd: string
  /** 押す前の未消化講習の残(この行)。 */
  count: number
  /** 押す前のこの生徒の未消化振替の残(科目の合計・正の分だけ)。 */
  makeupBalance: number
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

/**
 * 台本 h の操作を選ぶ(AUTO_ASSIGN_OPS の順・種つきの乱数・操作ごとに別の生徒)。対象＝未消化講習の行(stock.lectureRows)のうち、
 * 名簿の生徒に結べ・今日在籍し・講習が教室データにあり・期間が決まっていて、期間の終わりが今日以降のもの(期間の初日が今日より前でもよい)。
 * 期間が今日より前の行(過去の講習の残り)は室長がふだん押さないので選ばない(pastOnlyCount に数える)。
 * 「未消化振替も同時に」は、未消化振替の残がある生徒を先に取る(1 回目の講習だけに取られないよう、選ぶ順は振替の残のある生徒 → 講習だけ → 残りの生徒。
 * 残のある生徒が居なければ残の無い生徒でも選ぶ＝講習の部分は確かめられる)。
 */
export function pickAutoAssignPlan(params: { stock: StockBalances; payload: Partial<AppSnapshotPayload>; todayKey: string; random: () => number }): { ops: AutoAssignPlanOp[]; skipped: string[]; pastOnlyCount: number } {
  const { stock, todayKey, random } = params
  const payload = isPlainObject(params.payload) ? params.payload : {}
  const roster = new Map(asArray<StudentRow>(payload.students).map((row) => [row.id, row]))
  const sessionIds = new Set(asArray<SpecialSessionRow>(payload.specialSessions).map((session) => session.id))
  const reasons = { past: 0, undated: 0, unlinked: 0, inactive: 0, noSession: 0 }
  const eligible = []
  for (const row of stock.lectureRows ?? []) {
    if (row.count <= 0) continue
    const student = row.studentId ? roster.get(row.studentId) : undefined
    if (!row.studentId || !student) { reasons.unlinked += 1; continue }
    if (!isActiveOnDate(student.entryDate ?? '', student.withdrawDate ?? '', student.birthDate ?? '', todayKey)) { reasons.inactive += 1; continue }
    if (!row.periodStart || !row.periodEnd || !row.sessionId) { reasons.undated += 1; continue }
    if (!sessionIds.has(row.sessionId)) { reasons.noSession += 1; continue }
    if (row.periodEnd < todayKey) { reasons.past += 1; continue }
    const makeupBalance = Object.entries(stock.makeup ?? {}).filter(([key, value]) => key.startsWith(`${row.studentId}__`) && value > 0).reduce((sum, [, value]) => sum + value, 0)
    eligible.push({ row, studentId: row.studentId, makeupBalance })
  }
  const pickOne = <T>(list: T[]) => list[Math.floor(random() * list.length)]
  const usedStudents = new Set<string>()
  const chosenByName = new Map<string, (typeof eligible)[number]>()
  const take = (name: string, list: typeof eligible) => {
    if (list.length === 0) return
    const chosen = pickOne(list)
    usedStudents.add(chosen.studentId)
    chosenByName.set(name, chosen)
  }
  const free = () => eligible.filter((item) => !usedStudents.has(item.studentId))
  // 振替の残がある生徒を「未消化振替も同時に」へ先に取る(講習だけの 1 回目に取られて、振替を確かめられなくならないように)。
  take('with-makeup', free().filter((item) => item.makeupBalance > 0))
  take('lecture-only', free())
  if (!chosenByName.has('with-makeup')) take('with-makeup', free())
  const ops: AutoAssignPlanOp[] = []
  const skipped: string[] = []
  for (const spec of AUTO_ASSIGN_OPS) {
    const chosen = chosenByName.get(spec.name)
    if (!chosen) {
      skipped.push(`${spec.label}: ${eligible.length === 0 ? '割り振れる未消化講習の行が無い' : 'ほかの生徒の未消化講習の行が無い(1 回目と別の生徒にする)'}`)
      continue
    }
    ops.push({
      name: spec.name, label: spec.label, includeMakeup: spec.includeMakeup, entryKey: chosen.row.key, studentKey: chosen.studentId, sessionId: chosen.row.sessionId,
      periodStart: chosen.row.periodStart, periodEnd: chosen.row.periodEnd, count: chosen.row.count, makeupBalance: chosen.makeupBalance,
    })
  }
  const counted = [
    reasons.past > 0 ? `期間が今日より前(過去の講習の残り) ${reasons.past} 行` : '',
    reasons.undated > 0 ? `期間の無い行(講習に結べない手動追加) ${reasons.undated} 行` : '',
    reasons.unlinked > 0 ? `名簿に結べない ${reasons.unlinked} 行` : '',
    reasons.inactive > 0 ? `今日在籍していない ${reasons.inactive} 行` : '',
    reasons.noSession > 0 ? `講習が見つからない ${reasons.noSession} 行` : '',
  ].filter(Boolean)
  if (counted.length > 0) skipped.push(`選ばなかった未消化講習の行: ${counted.join('・')}`)
  return { ops, skipped, pastOnlyCount: reasons.past }
}

/** 期間の日付(YYYY-MM-DD・両端を含む)。 */
export function collectPeriodDateKeys(start: string, end: string): string[] {
  if (!start || !end || end < start) return []
  const result: string[] = []
  for (let time = Date.parse(`${start}T00:00:00Z`); ; time += 86400000) {
    const key = new Date(time).toISOString().slice(0, 10)
    if (key > end) break
    result.push(key)
  }
  return result
}

/** 期間を含む週の月曜(盤面の週は月曜から)。アプリは週を開いたときに初めてその週を作るので、押す前に全部開く。 */
export function periodWeekStarts(start: string, end: string): string[] {
  const mondays = new Set<string>()
  for (const key of collectPeriodDateKeys(start, end)) {
    const time = Date.parse(`${key}T00:00:00Z`)
    mondays.add(new Date(time - ((new Date(time).getUTCDay() + 6) % 7) * 86400000).toISOString().slice(0, 10))
  }
  return [...mondays]
}

/**
 * 在庫の仕様の増減(INV-06)。置いた講習 n 席 → その行の未消化講習 −n(handleAutoAssignLectureStockEntry が台帳 manualLectureStockCounts へ −1 ずつ)。
 * 置いた振替 → 生徒キー__科目 ごとに −n(未消化振替は盤面の振替を消化として数える)。書いていない鍵はすべて ±0(対象でない生徒の在庫は動かない)。
 */
export function expectedAutoAssignStockDeltas(op: Pick<AutoAssignPlanOp, 'entryKey' | 'studentKey'>, placements: ReadonlyArray<Pick<AutoAssignPlacement, 'lessonType' | 'subject'>>) {
  const lecture: Record<string, number> = {}
  const makeup: Record<string, number> = {}
  for (const placed of placements) {
    if (placed.lessonType === 'special') lecture[op.entryKey] = (lecture[op.entryKey] ?? 0) - 1
    else if (placed.lessonType === 'makeup') {
      const key = `${op.studentKey}__${placed.subject}`
      makeup[key] = (makeup[key] ?? 0) - 1
    }
  }
  return { lecture, makeup }
}

/** 止めずに注へ出す(道具の側で確かめられない)制約事項。 */
const UNCHECKED_CONSTRAINT_KEYS: AutoAssignRuleKey[] = ['regularTeachersOnly', 'maxOneLesson', 'maxTwoLessons', 'maxThreeLessons']

function normalizeWeeks(value: unknown): SlotCell[][] {
  return asArray<unknown>(value).map((week) => (Array.isArray(week) ? (week as SlotCell[]) : asArray<SlotCell>((week as { cells?: unknown })?.cells)))
}

/**
 * 置いた席の決まり(アプリの権威関数で確かめられる範囲)。payload は自動割振のあとの教室データ。
 * - 出席不可のコマ(その生徒のどの講習の提出でも、resolveEffectiveUnavailableSlots＝不可 − 出席可能に変更)に置いた → stop(findBestAutoAssignCandidate の studentUnavailableSlots と同じ集め方)。
 * - 制約事項(区分=制約・その生徒が対象)の「指定時限禁止」の時限に置いた → stop。
 * - 制約事項「科目対応講師のみ」で、机の講師(teacherAssignmentTeacherId で名簿から引けたとき)がその科目を持たない → stop。引けない机は注に数える。
 * - 確かめられない制約事項(通常講師のみ・1 日のコマ数の上限)が制約になっていれば注に出す。
 * 学年は置いた生徒の grade(アプリが置いた日の学年で付けた値)。
 */
export function checkAutoAssignPlacementRules(payload: Partial<AppSnapshotPayload>, placements: ReadonlyArray<AutoAssignPlacement>, studentId: string): { findings: PatrolFinding[]; notes: string[] } {
  const safe = isPlainObject(payload) ? payload : {}
  const findings: PatrolFinding[] = []
  const notes: string[] = []
  const unavailable = new Set<string>()
  for (const session of asArray<SpecialSessionRow>(safe.specialSessions)) {
    for (const slotKey of resolveEffectiveUnavailableSlots(session?.studentInputs?.[studentId])) unavailable.add(slotKey)
  }
  const rules = asArray<AutoAssignRuleRow>(safe.autoAssignRules)
  const ruleByKey = new Map(rules.map((rule) => [rule.key, rule]))
  const forbidRule = ruleByKey.get('forbidFirstPeriod')
  const forbidConstraint = resolveRuleCategory(forbidRule) === 'constraint'
  const subjectConstraint = resolveRuleCategory(ruleByKey.get('subjectCapableTeachersOnly')) === 'constraint'
  const teachers = new Map(asArray<TeacherRow>(safe.teachers).map((row) => [row.id, row]))
  const cells = new Map<string, SlotCell>()
  for (const week of normalizeWeeks((safe.boardState as { weeks?: unknown } | undefined)?.weeks)) for (const cell of week) if (cell?.id) cells.set(cell.id, cell)
  let unresolvedTeacher = 0
  const unchecked = new Set<string>()
  for (const placed of placements) {
    const desk = cells.get(placed.cellId)?.desks?.[placed.deskIndex]
    const entry = desk?.lesson?.studentSlots?.[placed.seat] ?? null
    const grade = (entry?.grade ?? '') as GradeLabel
    const where = `${placed.dateKey} ${placed.slotNumber}限 机${placed.deskIndex + 1} 席${placed.seat + 1} ${placed.subject}`
    const location = { dateKey: placed.dateKey, slotNumber: placed.slotNumber, deskIndex: placed.deskIndex, studentId }
    const violated = (reason: string) => findings.push({ level: 'stop', code: 'auto-assign-rule-violated', message: `自動割振で置いた席が決まりに反する(${reason}): ${where} ${studentId}`, ...location })
    if (unavailable.has(`${placed.dateKey}_${placed.slotNumber}`)) violated('出席不可のコマ(講習の提出)')
    if (forbidConstraint && isAutoAssignRuleApplicable(forbidRule, studentId, grade) && resolveForbiddenPeriods(forbidRule).includes(placed.slotNumber)) {
      violated(`制約事項「指定時限禁止」の ${placed.slotNumber}限`)
    }
    if (subjectConstraint && isSubjectCapabilityConstraintApplicable(ruleByKey, studentId, grade)) {
      const teacher = desk?.teacherAssignmentTeacherId ? teachers.get(desk.teacherAssignmentTeacherId) : undefined
      if (!teacher) unresolvedTeacher += 1
      else if (!canTeacherHandleStudentSubject(teacher, placed.subject as SubjectLabel, grade)) violated(`制約事項「科目対応講師のみ」・講師 ${teacher.id} はこの科目を持たない`)
    }
    for (const key of UNCHECKED_CONSTRAINT_KEYS) {
      const rule = ruleByKey.get(key)
      if (resolveRuleCategory(rule) === 'constraint' && isAutoAssignRuleApplicable(rule, studentId, grade)) unchecked.add(key)
    }
  }
  if (unresolvedTeacher > 0) notes.push(`制約事項「科目対応講師のみ」: 講師 ID で名簿から引けない机 ${unresolvedTeacher} 席は確かめていない(講師欄が名前だけの机)。`)
  if (unchecked.size > 0) notes.push(`確かめていない制約事項(この生徒が対象・区分=制約): ${[...unchecked].join('・')}(道具の側に判定を作らない・runbook の限界)。`)
  return { findings, notes }
}
