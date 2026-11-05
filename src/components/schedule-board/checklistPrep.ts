// 確認リストの「準備する」（自動準備・2026-11-06 オーナー選択「案 C（段階導入）」・docs/plan-2026-11-06-checklist-auto-prep.md・
// docs/spec-developer-report.md §E-2-4）の純関数。
//
// ★開発用教室・テスト教室だけ（パネルは App の isActingDevelopmentClassroom でしかマウントされず、コマ表の effect も
//   resolveChecklistPrepStep の isVerificationClassroom で断る＝二重のガード）。
// ★準備の中身はここで決める（入力＝開校ルール適用後の週・名簿・今日・反映開始日・保留マップ／出力＝操作の列と結果文、または置けない理由）。
//   コマ表は操作を当てて commitWeeks を 1 回通すだけ（出自の印・Undo・保存ボタンは室長の操作と同じ）。
// ★会計中立（INV-06）: 第 1 段は体験（lessonType 'trial'・manualAdded）・メモ・手で置く講師だけ。在庫を動かす休み・振替・講習は使わない。
// ★足すだけ（INV-02）: 既にある生徒・メモ・記録は消さない・動かさない。埋まっている席には置かない（applyChecklistPrepOps でも二重に確かめる）。
// ★一過性リクエスト（Issue #46 同型）: App の checklistPrepRequest → コマ表が 1 回だけ処理 → 結果を返して App が消費（null）。

import { getTeacherDisplayName, resolveTeacherRosterStatus, type TeacherRow } from '../basic-data/basicDataModel'
import { resolveManualTeacherAssignmentSource, setManualTeacherAssignment } from './deskTeacherAssignment'
import { resolveDeskTeacherOrigin, resolveStudentOrigin } from './placementOrigin'
import { hasDeskTeacherRest } from './teacherRest'
import { buildTemplatePendingDeskKey, collectTemplatePendingLowerTeacherNames, type TemplatePendingDeskMap } from './templatePendingDesks'
import type { TeacherAliasResolver } from './templateDiffApply'
import type { DeskCell, GradeLabel, SlotCell, StudentEntry, SubjectLabel } from './types'

/** 「準備する」を出せる確認リストの項目 id（verificationChecklist.ts の autoPrep と一致・テストで固定）。 */
export const CHECKLIST_PREP_ITEM_IDS = ['v2-1', 'tp-64'] as const
export type ChecklistPrepItemId = (typeof CHECKLIST_PREP_ITEM_IDS)[number]

export function isChecklistPrepItemId(itemId: string): itemId is ChecklistPrepItemId {
  return (CHECKLIST_PREP_ITEM_IDS as readonly string[]).includes(itemId)
}

/** App → コマ表の一過性リクエスト。 */
export type ChecklistPrepRequest = { requestId: number; itemId: string }
/** パネルへ返す結果（結果文はそのまま項目の下に出す）。 */
export type ChecklistPrepResult = { ok: boolean; message: string }
/** コマ表 → App の処理結果。 */
export type ChecklistPrepRequestResult = ChecklistPrepResult & { requestId: number }

export function shouldProcessChecklistPrepRequest(request: ChecklistPrepRequest | null | undefined, processedRequestId: number | null): boolean {
  if (!request) return false
  return processedRequestId !== request.requestId
}

// 処理した requestId と今の state の requestId が一致するときだけ null 化する（より新しいリクエストは消さない）。
export function consumeChecklistPrepRequest(current: ChecklistPrepRequest | null, processedRequestId: number): ChecklistPrepRequest | null {
  if (current && current.requestId === processedRequestId) return null
  return current
}

export type ChecklistPrepOp =
  | { kind: 'trial'; cellId: string; deskIndex: number; studentIndex: number; name: string; grade: GradeLabel; subject: SubjectLabel }
  | { kind: 'memo'; cellId: string; deskIndex: number; studentIndex: number; text: string }
  | { kind: 'manual-teacher'; cellId: string; deskIndex: number; teacherName: string; teacherId: string }

export type ChecklistPrepPlanOk = { ok: true; dateKey: string; weekIndex: number; cellId: string; deskIndex: number; ops: ChecklistPrepOp[]; message: string }
export type ChecklistPrepPlan = ChecklistPrepPlanOk | { ok: false; reason: string }

export type ChecklistPrepInput = {
  itemId: string
  /** 開校ルール適用後の週（盤面の normalizedWeeks）。休校日の判定は isOpenDay だけで見る。 */
  weeks: SlotCell[][]
  todayKey: string
  /** 反映開始日。これ**より後**のコマだけを使う。無ければ今日より後。 */
  effectiveStartDate?: string | null
  /** 保留マップ（キーは机 ID）。保留の机は使わない。 */
  templatePendingDesks?: TemplatePendingDeskMap | null
  teachers: readonly TeacherRow[]
  teacherAliases?: TeacherAliasResolver
  /** 体験の学年・科目（無ければ 中1・英）。 */
  trialProfile?: { grade: GradeLabel; subject: SubjectLabel }
}

export const CHECKLIST_PREP_TRIAL_NAME_PREFIX = '確認用 体験'
export const CHECKLIST_PREP_MEMO_PREFIX = '確認用メモ'
export const CHECKLIST_PREP_SAVE_REMINDER = '盤面はまだ保存していません。「保存」を押してから、項目の「やること」を行ってください。'
export const CHECKLIST_PREP_NOT_VERIFICATION_MESSAGE = '開発用教室・テスト教室でだけ準備できます。'
export const CHECKLIST_PREP_TEMPLATE_MODE_MESSAGE = 'テンプレート編集中は準備できません。編集を終了してから、もう一度押してください。'
export const CHECKLIST_PREP_UNKNOWN_ITEM_MESSAGE = 'この項目は自動で準備できません。'
export const CHECKLIST_PREP_JUMP_FAILED_MESSAGE = '準備するコマの週へ移れませんでした。コマ表を開いてから、もう一度押してください。'

const DEFAULT_TRIAL_PROFILE: { grade: GradeLabel; subject: SubjectLabel } = { grade: '中1', subject: '英' }
const defaultAliases: TeacherAliasResolver = (key) => [key]

function shiftDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number)
  const date = new Date(Date.UTC(year, (month || 1) - 1, (day || 1) + days))
  return date.toISOString().slice(0, 10)
}

/** 使ってよい最初の日（反映開始日の翌日と今日の遅い方。反映開始日が無ければ明日）。 */
export function resolveChecklistPrepEarliestDateKey(todayKey: string, effectiveStartDate?: string | null) {
  const afterStart = shiftDateKey(effectiveStartDate || todayKey, 1)
  return afterStart > todayKey ? afterStart : todayKey
}

function hasStatusRecord(desk: DeskCell) {
  return desk.statusSlots?.some((entry) => entry != null) ?? false
}

function hasMemo(desk: DeskCell, seat: number) {
  return Boolean(desk.memoSlots?.[seat]?.trim())
}

function isSeatEmpty(desk: DeskCell, seat: number) {
  return !desk.lesson?.studentSlots[seat] && !hasMemo(desk, seat) && !desk.statusSlots?.[seat]
}

function isDeletedTombstone(desk: DeskCell) {
  return Boolean(desk.manualTeacher) && desk.teacherAssignmentSource === 'deleted'
}

type CellContext = { cell: SlotCell; weekIndex: number; pendingDeskIds: ReadonlySet<string> }

/** どの準備にも使えない机（保留・出欠記録・講師の休み・講師の削除記録）。 */
function isBlockedDesk(context: CellContext, desk: DeskCell) {
  return context.pendingDeskIds.has(desk.id) || hasStatusRecord(desk) || hasDeskTeacherRest(desk) || isDeletedTombstone(desk)
}

/** 授業もメモも無い机（体験を置く空き机）。 */
function isFreeDesk(context: CellContext, desk: DeskCell) {
  return !isBlockedDesk(context, desk) && !desk.lesson?.studentSlots.some(Boolean) && !hasMemo(desk, 0) && !hasMemo(desk, 1) && (!desk.teacher.trim() || resolveDeskTeacherOrigin(desk) === 'template')
}

function isTemplateTeacherDesk(desk: DeskCell) {
  return Boolean(desk.teacher.trim()) && resolveDeskTeacherOrigin(desk) === 'template'
}

/** テンプレの講師とテンプレの生徒が居る机（v2-1 の講師を替える机）。 */
function isTemplateLessonDesk(context: CellContext, desk: DeskCell) {
  if (isBlockedDesk(context, desk) || !isTemplateTeacherDesk(desk)) return false
  return desk.lesson?.studentSlots.some((student) => student && resolveStudentOrigin(student) === 'template') ?? false
}

/** tp-64: テンプレの講師とテンプレの生徒 1 人が居て、もう 1 席が空いている机。空いている席を返す（無ければ null）。 */
function findTemplateSingleLessonSeat(context: CellContext, desk: DeskCell): number | null {
  if (isBlockedDesk(context, desk) || !isTemplateTeacherDesk(desk) || !desk.lesson) return null
  const [first, second] = desk.lesson.studentSlots
  if (first && !second && resolveStudentOrigin(first) === 'template' && isSeatEmpty(desk, 1)) return 1
  if (second && !first && resolveStudentOrigin(second) === 'template' && isSeatEmpty(desk, 0)) return 0
  return null
}

function teacherKeys(teacher: TeacherRow, aliases: TeacherAliasResolver) {
  const keys = new Set<string>()
  for (const key of [teacher.id, teacher.name, teacher.displayName ?? '', getTeacherDisplayName(teacher)]) {
    const trimmed = key.trim()
    if (!trimmed) continue
    keys.add(trimmed)
    for (const alias of aliases(trimmed)) if (alias.trim()) keys.add(alias.trim())
  }
  return keys
}

/** そのコマのどの机にも居ない（呼び名の対応表で同じ人も避ける）在籍の講師を 1 人選ぶ。 */
function pickReplacementTeacher(context: CellContext, input: ChecklistPrepInput, aliases: TeacherAliasResolver, reserved: readonly string[]): TeacherRow | null {
  const occupied = new Set<string>()
  const addKey = (key: string | undefined) => {
    const trimmed = key?.trim()
    if (!trimmed) return
    occupied.add(trimmed)
    for (const alias of aliases(trimmed)) if (alias.trim()) occupied.add(alias.trim())
  }
  for (const desk of context.cell.desks) {
    addKey(desk.teacher)
    addKey(desk.teacherAssignmentTeacherId)
    addKey(desk.teacherRest?.teacher)
    addKey(desk.teacherRest?.teacherId)
  }
  for (const name of collectTemplatePendingLowerTeacherNames(input.templatePendingDesks, context.cell.id)) addKey(name)
  for (const key of reserved) addKey(key)
  return input.teachers.find((teacher) => {
    if (resolveTeacherRosterStatus(teacher, context.cell.dateKey) !== '在籍') return false
    const keys = teacherKeys(teacher, aliases)
    return ![...keys].some((key) => occupied.has(key))
  }) ?? null
}

function nextSerial(weeks: SlotCell[][], read: (desk: DeskCell) => Array<string | null | undefined>, prefix: string) {
  let max = 0
  for (const week of weeks) {
    for (const cell of week) {
      for (const desk of cell.desks) {
        for (const value of read(desk)) {
          if (!value?.startsWith(prefix)) continue
          const serial = Number(value.slice(prefix.length).trim())
          if (Number.isFinite(serial) && serial > max) max = serial
        }
      }
    }
  }
  return max + 1
}

function cellLabel(cell: SlotCell) {
  const day = cell.dayLabel ? `(${cell.dayLabel})` : ''
  return `${cell.dateLabel}${day} ${cell.slotLabel}`
}

function seatLabel(cell: SlotCell, deskIndex: number, seat: number) {
  return `${cellLabel(cell)} 机 ${deskIndex + 1} の生徒 ${seat + 1}`
}

function templateSeatLabel(cell: SlotCell, deskIndex: number, seat: number) {
  const day = cell.dayLabel ? `${cell.dayLabel}曜 ` : ''
  return `${day}${cell.slotLabel} 机 ${deskIndex + 1} の生徒 ${seat + 1}`
}

function listCandidateCells(input: ChecklistPrepInput): CellContext[] {
  const earliest = resolveChecklistPrepEarliestDateKey(input.todayKey, input.effectiveStartDate)
  const contexts: CellContext[] = []
  input.weeks.forEach((week, weekIndex) => {
    for (const cell of week) {
      if (!cell.isOpenDay || cell.dateKey < earliest) continue
      const pendingDeskIds = new Set(cell.desks.filter((desk) => input.templatePendingDesks?.[buildTemplatePendingDeskKey(cell.id, desk.id)]).map((desk) => desk.id))
      contexts.push({ cell, weekIndex, pendingDeskIds })
    }
  })
  return contexts.sort((left, right) => left.cell.dateKey.localeCompare(right.cell.dateKey) || left.cell.slotNumber - right.cell.slotNumber)
}

type CellPlan = { deskIndex: number; ops: ChecklistPrepOp[]; lines: string[] }

function planV21(context: CellContext, input: ChecklistPrepInput, aliases: TeacherAliasResolver, serials: { trial: number; memo: number }): CellPlan | null {
  const { cell } = context
  const desks = cell.desks
  // 体験を置く空き机: テンプレの講師だけの机を先に、無ければ講師も居ない机。
  const freeIndexes = desks.map((desk, index) => (isFreeDesk(context, desk) ? index : -1)).filter((index) => index >= 0)
  const trialDeskIndex = freeIndexes.find((index) => desks[index].teacher.trim()) ?? freeIndexes[0]
  if (trialDeskIndex == null) return null
  const teacherDeskIndex = desks.findIndex((desk, index) => index !== trialDeskIndex && isTemplateLessonDesk(context, desk))
  if (teacherDeskIndex < 0) return null
  const replacement = pickReplacementTeacher(context, input, aliases, [])
  if (!replacement) return null
  const profile = input.trialProfile ?? DEFAULT_TRIAL_PROFILE
  const trialName = `${CHECKLIST_PREP_TRIAL_NAME_PREFIX}${serials.trial}`
  const memoText = `${CHECKLIST_PREP_MEMO_PREFIX}${serials.memo}`
  const replacementName = getTeacherDisplayName(replacement)
  const previousTeacher = desks[teacherDeskIndex].teacher
  return {
    deskIndex: trialDeskIndex,
    ops: [
      { kind: 'trial', cellId: cell.id, deskIndex: trialDeskIndex, studentIndex: 0, name: trialName, grade: profile.grade, subject: profile.subject },
      { kind: 'memo', cellId: cell.id, deskIndex: trialDeskIndex, studentIndex: 1, text: memoText },
      { kind: 'manual-teacher', cellId: cell.id, deskIndex: teacherDeskIndex, teacherName: replacementName, teacherId: replacement.id },
    ],
    lines: [
      `${seatLabel(cell, trialDeskIndex, 0)} に体験「${trialName}」を置きました。`,
      `${seatLabel(cell, trialDeskIndex, 1)} にメモ「${memoText}」を書きました。`,
      `${cellLabel(cell)} 机 ${teacherDeskIndex + 1} の講師を ${previousTeacher} から ${replacementName} に替えました（手で置いた講師）。`,
    ],
  }
}

function planTp64(context: CellContext, input: ChecklistPrepInput, aliases: TeacherAliasResolver, serials: { trial: number; memo: number }): CellPlan | null {
  const { cell } = context
  const seats = cell.desks.map((desk) => findTemplateSingleLessonSeat(context, desk))
  const firstIndex = seats.findIndex((seat) => seat != null)
  if (firstIndex < 0) return null
  const secondIndex = seats.findIndex((seat, index) => index !== firstIndex && seat != null)
  if (secondIndex < 0) return null
  const replacement = pickReplacementTeacher(context, input, aliases, [])
  if (!replacement) return null
  const profile = input.trialProfile ?? DEFAULT_TRIAL_PROFILE
  const firstSeat = seats[firstIndex]!
  const secondSeat = seats[secondIndex]!
  const firstName = `${CHECKLIST_PREP_TRIAL_NAME_PREFIX}${serials.trial}`
  const secondName = `${CHECKLIST_PREP_TRIAL_NAME_PREFIX}${serials.trial + 1}`
  const replacementName = getTeacherDisplayName(replacement)
  const previousTeacher = cell.desks[firstIndex].teacher
  return {
    deskIndex: firstIndex,
    ops: [
      { kind: 'manual-teacher', cellId: cell.id, deskIndex: firstIndex, teacherName: replacementName, teacherId: replacement.id },
      { kind: 'trial', cellId: cell.id, deskIndex: firstIndex, studentIndex: firstSeat, name: firstName, grade: profile.grade, subject: profile.subject },
      { kind: 'trial', cellId: cell.id, deskIndex: secondIndex, studentIndex: secondSeat, name: secondName, grade: profile.grade, subject: profile.subject },
    ],
    lines: [
      `(1) ${cellLabel(cell)} 机 ${firstIndex + 1} の講師を ${previousTeacher} から ${replacementName} に替え（手で置いた講師）、生徒 ${firstSeat + 1} に体験「${firstName}」を置きました。`,
      `(2) ${seatLabel(cell, secondIndex, secondSeat)} に体験「${secondName}」を置きました。`,
      `残る手作業: (1) は何も変えずにテンプレを保存すれば、この机の講師欄が 2 行（上=${previousTeacher}・下=${replacementName}）になります。`
        + `(2) は「通常授業テンプレ作成」で ${templateSeatLabel(cell, secondIndex, secondSeat)} に誰かを登録して保存してください。`
        + `(1) で生徒の採用も確かめるときは、同じ保存の前に ${templateSeatLabel(cell, firstIndex, firstSeat)} にも誰かを登録してください。`,
    ],
  }
}

const ITEM_PLANNERS: Record<ChecklistPrepItemId, typeof planV21> = {
  'v2-1': planV21,
  'tp-64': planTp64,
}

const ITEM_NOT_FOUND_REASONS: Record<ChecklistPrepItemId, string> = {
  'v2-1': '空き机と、テンプレの講師・生徒が居る机が揃うコマ',
  'tp-64': 'テンプレの講師と生徒 1 人だけの机が 2 つあるコマ',
}

/** 準備の置き場と操作を決める（純関数・weeks は書き換えない）。 */
export function planChecklistPrep(input: ChecklistPrepInput): ChecklistPrepPlan {
  if (!isChecklistPrepItemId(input.itemId)) return { ok: false, reason: CHECKLIST_PREP_UNKNOWN_ITEM_MESSAGE }
  const aliases = input.teacherAliases ?? defaultAliases
  const serials = {
    trial: nextSerial(input.weeks, (desk) => (desk.lesson?.studentSlots ?? []).map((student) => student?.name), CHECKLIST_PREP_TRIAL_NAME_PREFIX),
    memo: nextSerial(input.weeks, (desk) => desk.memoSlots ?? [], CHECKLIST_PREP_MEMO_PREFIX),
  }
  const planner = ITEM_PLANNERS[input.itemId]
  for (const context of listCandidateCells(input)) {
    const planned = planner(context, input, aliases, serials)
    if (!planned) continue
    return {
      ok: true,
      dateKey: context.cell.dateKey,
      weekIndex: context.weekIndex,
      cellId: context.cell.id,
      deskIndex: planned.deskIndex,
      ops: planned.ops,
      message: [...planned.lines, CHECKLIST_PREP_SAVE_REMINDER].join('\n'),
    }
  }
  const earliest = resolveChecklistPrepEarliestDateKey(input.todayKey, input.effectiveStartDate)
  return {
    ok: false,
    reason: `${earliest} 以降の表示できる週に、${ITEM_NOT_FOUND_REASONS[input.itemId]}が見つかりませんでした（休校日・保留（2 行）の机・出欠記録のある机は使いません）。何も変えていません。`,
  }
}

function cloneDeskForPrep(desk: DeskCell): DeskCell {
  return {
    ...desk,
    ...(desk.memoSlots ? { memoSlots: [...desk.memoSlots] as [string | null, string | null] } : {}),
    ...(desk.lesson ? { lesson: { ...desk.lesson, studentSlots: [...desk.lesson.studentSlots] as [StudentEntry | null, StudentEntry | null] } } : {}),
  }
}

/**
 * 操作を当てた新しい weeks を返す（入力は書き換えない・触るコマだけ作り直す）。埋まっている席・メモのある席・記録のある席には置かない
 * （既存を消さない＝INV-02）。体験は手動の「体験追加」と同じ形（id・lesson.id の規則）。講師は講師メニューの「保存」と同じ書き込み。
 */
export function applyChecklistPrepOps(weeks: SlotCell[][], ops: readonly ChecklistPrepOp[], aliases?: TeacherAliasResolver, options: { now?: number } = {}): SlotCell[][] {
  const stamp = (options.now ?? Date.now()).toString(36)
  const touchedCellIds = new Set(ops.map((op) => op.cellId))
  return weeks.map((week) => {
    if (!week.some((cell) => touchedCellIds.has(cell.id))) return week
    return week.map((cell) => {
      if (!touchedCellIds.has(cell.id)) return cell
      const nextCell: SlotCell = { ...cell, desks: cell.desks.map(cloneDeskForPrep) }
      for (const op of ops) {
        if (op.cellId !== cell.id) continue
        const desk = nextCell.desks[op.deskIndex]
        if (!desk) continue
        if (op.kind === 'manual-teacher') {
          setManualTeacherAssignment(desk, op.teacherName, op.teacherId, resolveManualTeacherAssignmentSource(desk), aliases)
          continue
        }
        if (!isSeatEmpty(desk, op.studentIndex)) continue
        if (op.kind === 'memo') {
          const memoSlots: [string | null, string | null] = desk.memoSlots ? [...desk.memoSlots] as [string | null, string | null] : [null, null]
          memoSlots[op.studentIndex] = op.text
          desk.memoSlots = memoSlots
          continue
        }
        const student: StudentEntry = {
          id: `${cell.id}_${op.deskIndex}_${op.studentIndex}_${stamp}`,
          name: op.name,
          grade: op.grade,
          subject: op.subject,
          lessonType: 'trial',
          teacherType: 'normal',
          manualAdded: true,
        }
        if (!desk.lesson) desk.lesson = { id: `${cell.id}_desk_${op.deskIndex + 1}_manual`, studentSlots: [null, null] }
        desk.lesson.studentSlots[op.studentIndex] = student
      }
      return nextCell
    })
  })
}

export type ChecklistPrepStep =
  | { kind: 'finish'; ok: false; message: string }
  | { kind: 'jump'; dateKey: string }
  | { kind: 'apply'; plan: ChecklistPrepPlanOk }

/** 1 リクエストで週を移ってよい回数（盤面の週を作る 1 回＋置き場の週へ移る 1 回）。 */
export const CHECKLIST_PREP_MAX_JUMPS = 2

/**
 * コマ表の effect が 1 回のレンダーで行う判断（純関数）。断る（検証用教室でない・テンプレ編集中・準備できない項目）→
 * 盤面の週が使える日まで届いていなければその日へ移る → 置き場を決める → 置き場の週が表示中でなければ移る → 当てる。
 */
export function resolveChecklistPrepStep(params: {
  request: ChecklistPrepRequest
  isVerificationClassroom: boolean
  isTemplateMode: boolean
  currentWeekIndex: number
  /** このリクエストで既に週を移った回数。 */
  jumpCount: number
  input: Omit<ChecklistPrepInput, 'itemId'>
}): ChecklistPrepStep {
  const { request, input } = params
  if (!params.isVerificationClassroom) return { kind: 'finish', ok: false, message: CHECKLIST_PREP_NOT_VERIFICATION_MESSAGE }
  if (params.isTemplateMode) return { kind: 'finish', ok: false, message: CHECKLIST_PREP_TEMPLATE_MODE_MESSAGE }
  if (!isChecklistPrepItemId(request.itemId)) return { kind: 'finish', ok: false, message: CHECKLIST_PREP_UNKNOWN_ITEM_MESSAGE }
  const earliest = resolveChecklistPrepEarliestDateKey(input.todayKey, input.effectiveStartDate)
  const reachesEarliest = input.weeks.some((week) => week.some((cell) => cell.dateKey >= earliest))
  if (!reachesEarliest) {
    if (params.jumpCount >= CHECKLIST_PREP_MAX_JUMPS) return { kind: 'finish', ok: false, message: CHECKLIST_PREP_JUMP_FAILED_MESSAGE }
    return { kind: 'jump', dateKey: earliest }
  }
  const plan = planChecklistPrep({ ...input, itemId: request.itemId })
  if (!plan.ok) return { kind: 'finish', ok: false, message: plan.reason }
  if (plan.weekIndex !== params.currentWeekIndex) {
    if (params.jumpCount >= CHECKLIST_PREP_MAX_JUMPS) return { kind: 'finish', ok: false, message: CHECKLIST_PREP_JUMP_FAILED_MESSAGE }
    return { kind: 'jump', dateKey: plan.dateKey }
  }
  return { kind: 'apply', plan }
}
