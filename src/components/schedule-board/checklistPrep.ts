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

import { getTeacherDisplayName, isActiveOnDate, resolveTeacherRosterStatus, type StudentRow, type TeacherRow } from '../basic-data/basicDataModel'
import { resolveManualTeacherAssignmentSource, setManualTeacherAssignment } from './deskTeacherAssignment'
import type { RegularLessonTemplate } from '../regular-template/regularLessonTemplate'
import { isChecklistPrepTemplateSeatTaken, listAvailableChecklistPrepStudents, type ChecklistPrepTemplateRegistration } from './checklistPrepTemplate'
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

/**
 * 第 2 段（§E-2-4-2・2026-11-06 オーナー選択「まず tp-64 だけ」）: 盤面の準備に続けてテンプレへの登録と保存まで行う項目。
 * App はこの項目のとき確認用の生徒を名簿へ足してからリクエストを立て、コマ表は planChecklistPrep の templateRegistrations をテンプレへ登録して保存する。
 */
export const CHECKLIST_PREP_TEMPLATE_ITEM_IDS = ['tp-64'] as const
export type ChecklistPrepTemplateItemId = (typeof CHECKLIST_PREP_TEMPLATE_ITEM_IDS)[number]

export function checklistPrepNeedsTemplate(itemId: string): itemId is ChecklistPrepTemplateItemId {
  return (CHECKLIST_PREP_TEMPLATE_ITEM_IDS as readonly string[]).includes(itemId)
}

/** テンプレに登録する確認用の生徒の数（項目ごと）。 */
export const CHECKLIST_PREP_TEMPLATE_STUDENT_COUNT: Record<ChecklistPrepTemplateItemId, number> = { 'tp-64': 2 }

/**
 * App → コマ表の一過性リクエスト。classroomId は押したときに開いていた教室（App の actingClassroomId）。コマ表は自分の教室と違うリクエストを
 * 処理しない（教室切り替えの取りやめ effect より先にコマ表の effect が走っても、前の教室で押した準備を次の教室へ置かない・INV-08）。
 */
export type ChecklistPrepRequest = { requestId: number; itemId: string; classroomId: string | null }
/** パネルへ返す結果（結果文はそのまま項目の下に出す）。 */
export type ChecklistPrepResult = { ok: boolean; message: string }
/** コマ表 → App の処理結果。 */
export type ChecklistPrepRequestResult = ChecklistPrepResult & { requestId: number }

/**
 * コマ表の effect がこのレンダーでリクエストを処理してよいか。処理済み・押した教室とコマ表の教室が違う・教室データの読み込みが済んでいない
 * （isEditingStateLoadedForActingClassroom が false）間は false（消費もしない＝待つ。取りやめは App が教室切り替え・boardMountKey で行い、
 * 待ちすぎは App の保険タイマーで失敗に返す）。
 */
export function shouldProcessChecklistPrepRequest(
  request: ChecklistPrepRequest | null | undefined,
  processedRequestId: number | null,
  board: { classroomId: string | null; isEditingStateLoaded: boolean },
): boolean {
  if (!request) return false
  if (processedRequestId === request.requestId) return false
  if (!request.classroomId || request.classroomId !== board.classroomId) return false
  return board.isEditingStateLoaded
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

export type ChecklistPrepPlanOk = {
  ok: true
  dateKey: string
  weekIndex: number
  cellId: string
  deskIndex: number
  ops: ChecklistPrepOp[]
  /** テンプレへ登録する席（第 2 段の項目で template を渡したときだけ。v2-1・第 1 段は空）。 */
  templateRegistrations: ChecklistPrepTemplateRegistration[]
  message: string
}
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
  /**
   * 第 2 段（§E-2-4-2）: 今のテンプレ（反映開始日で在籍に絞ったもの）。**渡したとき（null＝テンプレ未作成を含む）だけ**第 2 段として、
   * テンプレのその曜日・時限・机の同じ席が空いている机だけを選び、その席を templateRegistrations に返す。undefined なら第 1 段のまま（手作業の文）。
   */
  template?: RegularLessonTemplate | null
  /** 第 2 段: 名簿の確認用の生徒。渡したときは、その曜日・時限に登録できる確認用の生徒が足りないコマを使わない（INV-12）。 */
  prepStudents?: readonly StudentRow[]
}

export const CHECKLIST_PREP_TRIAL_NAME_PREFIX = '確認用 体験'
export const CHECKLIST_PREP_MEMO_PREFIX = '確認用メモ'
export const CHECKLIST_PREP_SAVE_REMINDER = '盤面はまだ保存していません。「保存」を押してから、項目の「やること」を行ってください。'
export const CHECKLIST_PREP_NOT_VERIFICATION_MESSAGE = '開発用教室・テスト教室でだけ準備できます。'
export const CHECKLIST_PREP_TEMPLATE_MODE_MESSAGE = 'テンプレート編集中は準備できません。編集を終了してから、もう一度押してください。'
export const CHECKLIST_PREP_UNKNOWN_ITEM_MESSAGE = 'この項目は自動で準備できません。'
export const CHECKLIST_PREP_JUMP_FAILED_MESSAGE = '準備するコマの週へ移れませんでした。コマ表を開いてから、もう一度押してください。'
/** 当てるときに机や席が見つからず 1 つでも置けなかった（コマ表は何も変えない）。 */
export const CHECKLIST_PREP_DESK_SHORTAGE_MESSAGE = 'コマ表の机が足りず置けませんでした。もう一度押してください。'

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

/**
 * 講師も授業もメモも無い机（v2-1 の空き机）。テンプレの講師だけの机は数えない（そこへ置いた手入力はテンプレの講師の机になり、
 * 手で置く講師ならテンプレ保存で講師欄が緑 2 行〔§2-3〕になって v2-1 の目安「緑の 2 行は出ず」と食い違う・regression-reviewer 要修正 1）。
 */
function isEmptyDesk(context: CellContext, desk: DeskCell) {
  return !isBlockedDesk(context, desk) && !desk.teacher.trim() && !desk.lesson?.studentSlots.some(Boolean) && !hasMemo(desk, 0) && !hasMemo(desk, 1)
}

function isTemplateTeacherDesk(desk: DeskCell) {
  return Boolean(desk.teacher.trim()) && resolveDeskTeacherOrigin(desk) === 'template'
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

/** 盤面のコマの曜日（0=日 … 6=土・テンプレの dayOfWeek と同じ）。 */
function resolveCellDayOfWeek(cell: SlotCell) {
  const [year, month, day] = cell.dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1)).getUTCDay()
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

type CellPlan = { deskIndex: number; ops: ChecklistPrepOp[]; lines: string[]; templateRegistrations: ChecklistPrepTemplateRegistration[] }

// v2-1（青字・案 A の並び替え → テンプレ保存）: 講師も授業も無い空き机を 3 つ使う。1 つ目に体験 2 人（並び替えで「2 人の机」として上へ詰まる）・
// 2 つ目の席 1 にメモ・3 つ目に手で置く講師（授業なし）。テンプレの講師と生徒の机は替えない（替えるとテンプレ保存で講師欄が緑 2 行になる）。
// 空き机が 3 つ無いコマは使わない（次のコマを探す）。
function planV21(context: CellContext, input: ChecklistPrepInput, aliases: TeacherAliasResolver, serials: { trial: number; memo: number }): CellPlan | null {
  const { cell } = context
  const emptyIndexes = cell.desks.map((desk, index) => (isEmptyDesk(context, desk) ? index : -1)).filter((index) => index >= 0)
  if (emptyIndexes.length < 3) return null
  const [trialDeskIndex, memoDeskIndex, teacherDeskIndex] = emptyIndexes
  const teacher = pickReplacementTeacher(context, input, aliases, [])
  if (!teacher) return null
  const profile = input.trialProfile ?? DEFAULT_TRIAL_PROFILE
  const firstName = `${CHECKLIST_PREP_TRIAL_NAME_PREFIX}${serials.trial}`
  const secondName = `${CHECKLIST_PREP_TRIAL_NAME_PREFIX}${serials.trial + 1}`
  const memoText = `${CHECKLIST_PREP_MEMO_PREFIX}${serials.memo}`
  const teacherName = getTeacherDisplayName(teacher)
  return {
    deskIndex: trialDeskIndex,
    ops: [
      { kind: 'trial', cellId: cell.id, deskIndex: trialDeskIndex, studentIndex: 0, name: firstName, grade: profile.grade, subject: profile.subject },
      { kind: 'trial', cellId: cell.id, deskIndex: trialDeskIndex, studentIndex: 1, name: secondName, grade: profile.grade, subject: profile.subject },
      { kind: 'memo', cellId: cell.id, deskIndex: memoDeskIndex, studentIndex: 0, text: memoText },
      { kind: 'manual-teacher', cellId: cell.id, deskIndex: teacherDeskIndex, teacherName, teacherId: teacher.id },
    ],
    lines: [
      `${cellLabel(cell)} 机 ${trialDeskIndex + 1} の生徒 1・生徒 2 に体験「${firstName}」「${secondName}」を置きました（講師なしの机に 2 人）。`,
      `${seatLabel(cell, memoDeskIndex, 0)} にメモ「${memoText}」を書きました。`,
      `${cellLabel(cell)} 机 ${teacherDeskIndex + 1} に講師 ${teacherName} を手で置きました（授業の無い空き机）。`,
    ],
    templateRegistrations: [],
  }
}

// tp-64（講師欄の緑）: テンプレの講師と生徒 1 人の机を 2 つ使う。(1) は講師を手で替えて空いた席に体験、(2) は空いた席に体験。
// 第 2 段（input.template を渡したとき）: テンプレのその曜日・時限・机の同じ席が空いている机だけを選び、その席を確認用の生徒の登録先に返す
// （登録と保存はコマ表が assignChecklistPrepTemplateStudents → 手で保存するときと同じ差分反映で行う）。
function planTp64(context: CellContext, input: ChecklistPrepInput, aliases: TeacherAliasResolver, serials: { trial: number; memo: number }): CellPlan | null {
  const { cell } = context
  const stage2 = input.template !== undefined
  const dayOfWeek = resolveCellDayOfWeek(cell)
  if (stage2 && input.prepStudents) {
    const needed = CHECKLIST_PREP_TEMPLATE_STUDENT_COUNT['tp-64']
    if (listAvailableChecklistPrepStudents(input.template, dayOfWeek, cell.slotNumber, input.prepStudents).length < needed) return null
  }
  const seats = cell.desks.map((desk, deskIndex) => {
    const seat = findTemplateSingleLessonSeat(context, desk)
    if (seat == null) return null
    if (stage2 && isChecklistPrepTemplateSeatTaken(input.template, dayOfWeek, cell.slotNumber, deskIndex, seat)) return null
    return seat
  })
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
  const afterSave = `保存すると (1) の机は講師欄が緑の 2 行（上=${previousTeacher}・下=${replacementName}）＋生徒 ${firstSeat + 1} も緑の 2 行、(2) の机は生徒 ${secondSeat + 1} だけが緑で講師欄は白のままです。`
  const templateRegistrations: ChecklistPrepTemplateRegistration[] = stage2
    ? [
        { dayOfWeek, slotNumber: cell.slotNumber, deskIndex: firstIndex, studentIndex: firstSeat as 0 | 1, subject: profile.subject, label: '(1)' },
        { dayOfWeek, slotNumber: cell.slotNumber, deskIndex: secondIndex, studentIndex: secondSeat as 0 | 1, subject: profile.subject, label: '(2)' },
      ]
    : []
  const templateLine = stage2
    ? `テンプレの (1)・(2) の席に確認用の生徒を登録して保存します（${templateSeatLabel(cell, firstIndex, firstSeat)} と ${templateSeatLabel(cell, secondIndex, secondSeat)}）。${afterSave}`
    : `残る手作業（必須）: 「通常授業テンプレ作成」で ${templateSeatLabel(cell, firstIndex, firstSeat)} と ${templateSeatLabel(cell, secondIndex, secondSeat)} の両方に誰かを登録して、テンプレを保存してください。${afterSave}`
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
      templateLine,
    ],
    templateRegistrations,
  }
}

const ITEM_PLANNERS: Record<ChecklistPrepItemId, typeof planV21> = {
  'v2-1': planV21,
  'tp-64': planTp64,
}

const ITEM_NOT_FOUND_REASONS: Record<ChecklistPrepItemId, string> = {
  'v2-1': '講師も授業も無い空き机が 3 つあるコマ',
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
      templateRegistrations: planned.templateRegistrations,
      message: [...planned.lines, CHECKLIST_PREP_SAVE_REMINDER].join('\n'),
    }
  }
  const earliest = resolveChecklistPrepEarliestDateKey(input.todayKey, input.effectiveStartDate)
  return {
    ok: false,
    reason: `${earliest} 以降の表示できる週に、${ITEM_NOT_FOUND_REASONS[input.itemId]}${checklistPrepNeedsTemplate(input.itemId) && input.template !== undefined ? '（テンプレの同じ席も空いている机）' : ''}が見つかりませんでした（休校日・保留（2 行）の机・出欠記録のある机は使いません）。何も変えていません。`,
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
 * skipped は置かなかった操作の数（コマ・机が見つからない／席が埋まっている）。1 つでもあればコマ表は commitWeeks を呼ばず失敗で返す
 * （置いていないのに「置きました」と言わない・regression-reviewer 要確認 3）。
 */
export function applyChecklistPrepOps(weeks: SlotCell[][], ops: readonly ChecklistPrepOp[], aliases?: TeacherAliasResolver, options: { now?: number } = {}): { weeks: SlotCell[][]; skipped: number } {
  const stamp = (options.now ?? Date.now()).toString(36)
  const touchedCellIds = new Set(ops.map((op) => op.cellId))
  let applied = 0
  const nextWeeks = weeks.map((week) => {
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
          applied += 1
          continue
        }
        if (!isSeatEmpty(desk, op.studentIndex)) continue
        if (op.kind === 'memo') {
          const memoSlots: [string | null, string | null] = desk.memoSlots ? [...desk.memoSlots] as [string | null, string | null] : [null, null]
          memoSlots[op.studentIndex] = op.text
          desk.memoSlots = memoSlots
          applied += 1
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
        applied += 1
      }
      return nextCell
    })
  })
  // 同じ cellId のコマが複数の週に重なって 2 回当たることは無い（cellId は日付＋時限）。見つからないコマの操作も skipped に入る。
  return { weeks: nextWeeks, skipped: Math.max(0, ops.length - applied) }
}

/** 体験の学年の見本にする生徒（今日在籍・生年月日あり・名簿の順で最初）。居なければ null（固定値 中1・英 を使う）。 */
export function pickChecklistPrepProfileStudent(students: readonly StudentRow[], todayKey: string): StudentRow | null {
  return students.find((student) => Boolean(student.birthDate) && isActiveOnDate(student.entryDate, student.withdrawDate, student.birthDate, todayKey)) ?? null
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
