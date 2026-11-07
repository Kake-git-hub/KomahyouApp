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
import type { RegularLessonTemplate, RegularLessonTemplateCell, RegularLessonTemplateDesk } from '../regular-template/regularLessonTemplate'
import {
  CHECKLIST_PREP_MEMO_PREFIX,
  CHECKLIST_PREP_SAVE_REMINDER,
  CHECKLIST_PREP_STUDENTS_MISSING_MESSAGE,
  CHECKLIST_PREP_TRIAL_NAME_PREFIX,
  buildChecklistPrepDoneMessage,
  findChecklistPrepTemplateDesk,
  hasChecklistPrepTemplateDeskContent,
  isUsableChecklistPrepStudent,
  isChecklistPrepTemplateSeatTaken,
  listAvailableChecklistPrepStudents,
  resolveChecklistPrepTemplateDeskIndex,
  type ChecklistPrepTemplateRegistration,
  type ChecklistPrepTemplateTeacherRegistration,
} from './checklistPrepTemplate'
import { resolveDeskTeacherOrigin, resolveStudentOrigin } from './placementOrigin'
import { hasDeskTeacherRest } from './teacherRest'
import { buildTemplatePendingDeskKey, collectTemplatePendingLowerTeacherNames, type TemplatePendingDeskMap } from './templatePendingDesks'
import type { TeacherAliasResolver } from './templateDiffApply'
import type { DeskCell, GradeLabel, SlotCell, StudentEntry, SubjectLabel } from './types'
import type { ChecklistPrepFacts } from '../../utils/verificationChecklist'

/**
 * 「準備する」を出せる確認リストの項目 id（verificationChecklist.ts の autoPrep と一致・テストで固定）。
 * 第 3 段（§E-2-4-3・2026-11-07）: tp-59・tp-69・tp-70（新しい置き方）、mn-1・tp-66（tp-64 と同じ置き方）を足した。
 */
export const CHECKLIST_PREP_ITEM_IDS = ['v2-1', 'tp-64', 'tp-59', 'tp-69', 'tp-70', 'mn-1', 'tp-66', 'tp-71', 'tp-72', 'tp-75', 'v2-3', 'v2-6'] as const
export type ChecklistPrepItemId = (typeof CHECKLIST_PREP_ITEM_IDS)[number]

/**
 * 第 4 段（docs/plan-2026-11-07-checklist-auto-prep-stage3.md §6・2026-11-07 オーナー回答）: テンプレ保存と盤面の操作を何段か続けて行う項目。
 * 段の中身は checklistPrepSequence.ts（planChecklistPrepSequenceStep）が決め、コマ表の effect は 1 段ずつ（1 レンダーに 1 段）当てる。
 * 盤面の操作は室長の操作と同じ純関数（computeStudentMove・computeStudentAbsentMark・computeMakeupStockPlacement）を通す。
 * 在庫（休み・振替）を動かすのは確認用の生徒だけ（オーナー回答・INV-06 はほかの生徒について固定）。
 */
export const CHECKLIST_PREP_SEQUENCE_ITEM_IDS = ['tp-71', 'tp-72', 'tp-75', 'v2-3', 'v2-6'] as const
export type ChecklistPrepSequenceItemId = (typeof CHECKLIST_PREP_SEQUENCE_ITEM_IDS)[number]

export function isChecklistPrepSequenceItemId(itemId: string): itemId is ChecklistPrepSequenceItemId {
  return (CHECKLIST_PREP_SEQUENCE_ITEM_IDS as readonly string[]).includes(itemId)
}

export function isChecklistPrepItemId(itemId: string): itemId is ChecklistPrepItemId {
  return (CHECKLIST_PREP_ITEM_IDS as readonly string[]).includes(itemId)
}

/**
 * 第 2 段（§E-2-4-2・2026-11-06 オーナー選択「まず tp-64 だけ」）: 盤面の準備に続けてテンプレへの登録と保存まで行う項目。
 * App はこの項目のとき確認用の生徒を名簿へ足してからリクエストを立て、コマ表は planChecklistPrep の templateRegistrations をテンプレへ登録して保存する。
 */
export const CHECKLIST_PREP_TEMPLATE_ITEM_IDS = ['tp-64', 'tp-59', 'tp-69', 'tp-70', 'mn-1', 'tp-66', 'tp-71', 'tp-72', 'tp-75', 'v2-3', 'v2-6'] as const
export type ChecklistPrepTemplateItemId = (typeof CHECKLIST_PREP_TEMPLATE_ITEM_IDS)[number]

export function checklistPrepNeedsTemplate(itemId: string): itemId is ChecklistPrepTemplateItemId {
  return (CHECKLIST_PREP_TEMPLATE_ITEM_IDS as readonly string[]).includes(itemId)
}

/**
 * テンプレに登録する確認用の生徒の数（項目ごと）。tp-70 はテンプレに講師だけを登録するので 0（名簿へ足さない）。
 * 第 4 段: tp-71・tp-72 は 2 人（A・B／A・C）。tp-75・v2-6 は 1 人を 2 つのコマに登録するので、両方のコマに登録できる生徒が見つかりやすいよう 2 人。
 * v2-3 は A（振替）・Q（緑の上の行）・R（動かして休み）の 3 人。
 */
export const CHECKLIST_PREP_TEMPLATE_STUDENT_COUNT: Record<ChecklistPrepTemplateItemId, number> = { 'tp-64': 2, 'mn-1': 2, 'tp-66': 2, 'tp-69': 1, 'tp-70': 0, 'tp-59': 1, 'tp-71': 2, 'tp-72': 2, 'tp-75': 2, 'v2-3': 3, 'v2-6': 2 }

/**
 * 第 3 段の新しい置き方（テンプレへ講師を登録する項目）。テンプレの差分反映が使えない教室（template を渡さない）・テンプレが無い教室では準備しない
 * （第 1 段の「手作業の文」に落とすと、テンプレの机と盤面の机の対応を人が探すことになる）。
 */
export const CHECKLIST_PREP_TEMPLATE_ONLY_ITEM_IDS = ['tp-59', 'tp-69', 'tp-70', ...CHECKLIST_PREP_SEQUENCE_ITEM_IDS] as const
const TEMPLATE_ONLY_ITEM_IDS: ReadonlySet<string> = new Set(CHECKLIST_PREP_TEMPLATE_ONLY_ITEM_IDS)
export const CHECKLIST_PREP_TEMPLATE_REQUIRED_MESSAGE = 'この項目は、テンプレの差分反映を使う教室で、テンプレを一度保存してから準備できます。何も変えていません。'

/**
 * App → コマ表の一過性リクエスト。classroomId は押したときに開いていた教室（App の actingClassroomId）。コマ表は自分の教室と違うリクエストを
 * 処理しない（教室切り替えの取りやめ effect より先にコマ表の effect が走っても、前の教室で押した準備を次の教室へ置かない・INV-08）。
 */
export type ChecklistPrepRequest = {
  requestId: number
  itemId: string
  classroomId: string | null
  /**
   * 'prep'（既定）＝項目の「準備する」、'cleanup'＝パネルの「後片づけ」（§E-2-4-2 決定 4・itemId は使わない）。
   * どちらも同じ一過性リクエスト・同じ待ち合わせ・同じ保険タイマー（App）で、コマ表の同じ effect が 1 回だけ処理する。
   */
  kind?: 'prep' | 'cleanup'
}
/**
 * コマ表 → App の途中経過（§E-2-4-2・修正ラウンド 1 I-2）。テンプレ保存の段を伴う準備・後片づけで、盤面を当てた（stage: 'board-applied'）ことを知らせる。
 * App は保険タイマーを延ばし（CHECKLIST_PREP_TEMPLATE_PHASE_TIMEOUT_MS）、以後のタイムアウト・取りやめ・差し替えの文を「盤面には置きましたが…」に切り替える
 * （途中まで進んだものは結果の文に書く・黙って消さない）。
 */
export type ChecklistPrepRequestProgress = {
  requestId: number; stage: 'board-applied'; kind: 'prep' | 'cleanup'
  /**
   * 第 4 段（§6）: 段を続ける準備の「ここまでに行ったこと」（テンプレの保存を含む）。あるときは取りやめ・タイムアウトの文をこれで書く
   * （「テンプレは保存していません」と言わない）。
   */
  summary?: string
}
/** 盤面を当てた後に延ばす保険タイマー（テンプレ保存の計算は確認画面の試し実行と同じ重さで数秒かかる）。 */
export const CHECKLIST_PREP_TEMPLATE_PHASE_TIMEOUT_MS = 30000
/** 教室データの読み込みが済む前に押された（App が名簿へ確認用の生徒を足す前に断る・INV-08）。 */
export const CHECKLIST_PREP_NOT_LOADED_MESSAGE = '教室のデータを読み込み中です。読み込みが終わってから、もう一度押してください。'

const ABORT_REASON_TEXT: Record<'timeout' | 'cancelled' | 'superseded', string> = {
  timeout: 'コマ表から返事がありませんでした',
  cancelled: '教室が切り替わったか、教室のデータが読み直されました',
  superseded: '新しい準備を始めました',
}

/**
 * App の保険タイマー・取りやめ・差し替えで返す文。盤面をまだ当てていなければ元の文（fallback）。当てた後（boardApplied）は、盤面に残っていることを書く。
 */
export function resolveChecklistPrepAbortMessage(reason: 'timeout' | 'cancelled' | 'superseded', fallback: string, boardApplied: { kind: 'prep' | 'cleanup'; summary?: string } | null): string {
  if (!boardApplied) return fallback
  if (boardApplied.summary) {
    return `途中で止まりました（${ABORT_REASON_TEXT[reason]}）。ここまでに行ったこと: ${boardApplied.summary} 盤面とテンプレはまだサーバーに保存していません。保存前なら盤面を確かめてください（「後片づけ」で準備を消せます）。`
  }
  const head = boardApplied.kind === 'cleanup' ? '盤面からは消しましたが、テンプレは保存していません' : '盤面には置きましたが、テンプレは保存していません'
  const tail = boardApplied.kind === 'cleanup' ? '保存前なら盤面を確かめてください。' : '保存前なら盤面を確かめてください（「後片づけ」で準備を消せます）。'
  return `${head}（${ABORT_REASON_TEXT[reason]}）。${tail}`
}

/**
 * パネルへ返す結果（結果文はそのまま項目の下に出す）。facts（第119版・2026-11-07）は項目の操作・確認の文の `{{prep:<キー>}}` に差し込む準備の事実
 * （いつ・どの机・誰。verificationChecklist.ts の resolveChecklistPrepFactTokens）。成功したときだけ載せる。画面だけ（下書き・送信本文には載せない）。
 */
export type ChecklistPrepResult = { ok: boolean; message: string; facts?: ChecklistPrepFacts }
/** 準備が載せる事実（slot＝準備したコマ「2/2(火) 2限」は必ず入れる・結果の文の「準備しました（…）」にも使う）。 */
export type ChecklistPrepPlanFacts = { slot: string } & Record<string, string>
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
  /** テンプレへ登録する講師（第 3 段・tp-59 / tp-69 / tp-70 だけ。講師も生徒も居ないテンプレの机に登録し、準備の印を付ける）。 */
  templateTeacherRegistrations: ChecklistPrepTemplateTeacherRegistration[]
  /**
   * 盤面で行ったことの詳しい文（何をどこに置いたか・テンプレへ何を登録するか）。テンプレ保存の段で止まった・失敗したときの文
   * （buildChecklistPrepTemplateFailedMessage・何が起きたかを黙って消さない）に使う。成功したときは doneMessage を出す。
   */
  message: string
  /** 第119版（2026-11-07）: 盤面だけの準備が済んだときの結果の文（「準備しました（日付 時限）。」＋保存の一言の 2 行）。 */
  doneMessage: string
  /** 第119版: 項目の文に差し込む準備の事実。テンプレへの登録で決まる確認用の生徒の名前（factKey）は保存後に足す。 */
  facts: ChecklistPrepPlanFacts
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

// 体験・メモの名前の頭と盤面の保存の一言（第 1 段から不変）。定義は後片づけ・第 2 段の結果の文（checklistPrepTemplate.ts）と共有するため向こうに置き、
// ここから再公開する（読み込みの向きを一方向に保つ）。
export { CHECKLIST_PREP_MEMO_PREFIX, CHECKLIST_PREP_SAVE_REMINDER, CHECKLIST_PREP_STUDENTS_MISSING_MESSAGE, CHECKLIST_PREP_TRIAL_NAME_PREFIX }
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

export function hasStatusRecord(desk: DeskCell) {
  return desk.statusSlots?.some((entry) => entry != null) ?? false
}

function hasMemo(desk: DeskCell, seat: number) {
  return Boolean(desk.memoSlots?.[seat]?.trim())
}

export function isSeatEmpty(desk: DeskCell, seat: number) {
  return !desk.lesson?.studentSlots[seat] && !hasMemo(desk, seat) && !desk.statusSlots?.[seat]
}

function isDeletedTombstone(desk: DeskCell) {
  return Boolean(desk.manualTeacher) && desk.teacherAssignmentSource === 'deleted'
}

export type CellContext = { cell: SlotCell; weekIndex: number; pendingDeskIds: ReadonlySet<string> }

/** どの準備にも使えない机（保留・出欠記録・講師の休み・講師の削除記録）。 */
export function isBlockedDesk(context: CellContext, desk: DeskCell) {
  return context.pendingDeskIds.has(desk.id) || hasStatusRecord(desk) || hasDeskTeacherRest(desk) || isDeletedTombstone(desk)
}

/**
 * 講師も授業もメモも無い机（v2-1 の空き机）。テンプレの講師だけの机は数えない（そこへ置いた手入力はテンプレの講師の机になり、
 * 手で置く講師ならテンプレ保存で講師欄が緑 2 行〔§2-3〕になって v2-1 の目安「緑の 2 行は出ず」と食い違う・regression-reviewer 要修正 1）。
 */
export function isEmptyDesk(context: CellContext, desk: DeskCell) {
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
export function pickReplacementTeacher(context: CellContext, input: ChecklistPrepInput, aliases: TeacherAliasResolver, reserved: readonly string[]): TeacherRow | null {
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

export function cellLabel(cell: SlotCell) {
  const day = cell.dayLabel ? `(${cell.dayLabel})` : ''
  return `${cell.dateLabel}${day} ${cell.slotLabel}`
}

function seatLabel(cell: SlotCell, deskIndex: number, seat: number) {
  return `${cellLabel(cell)} 机 ${deskIndex + 1} の生徒 ${seat + 1}`
}

/** 盤面のコマの曜日（0=日 … 6=土・テンプレの dayOfWeek と同じ）。 */
export function resolveCellDayOfWeek(cell: SlotCell) {
  const [year, month, day] = cell.dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, (month || 1) - 1, day || 1)).getUTCDay()
}

function templateSeatLabel(cell: SlotCell, deskIndex: number, seat: number) {
  const day = cell.dayLabel ? `${cell.dayLabel}曜 ` : ''
  return `${day}${cell.slotLabel} 机 ${deskIndex + 1} の生徒 ${seat + 1}`
}

export function listCandidateCells(input: ChecklistPrepInput): CellContext[] {
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

type CellPlan = {
  deskIndex: number; ops: ChecklistPrepOp[]; lines: string[]; templateRegistrations: ChecklistPrepTemplateRegistration[]; templateTeacherRegistrations?: ChecklistPrepTemplateTeacherRegistration[]
  /** 項目の文に差し込む事実（slot は planChecklistPrep が足す）。キーは項目の文の {{prep:<キー>}}（verificationChecklist.ts）と揃える。 */
  facts: Record<string, string>
  /** 手で残る作業（テンプレの差分反映の無い教室の tp-64 だけ）。成功の文の 1 行目に続けて書く。 */
  todo?: string
}

function deskText(deskIndex: number) {
  return `机 ${deskIndex + 1}`
}

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
    facts: { trial: firstName, X: teacherName },
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
  // 盤面の机ごとのテンプレの机番号（第 2 段だけ）。盤面の机番号 + 1 で決めない（盤面は詰めて置く・並び替えで動く・修正ラウンド 1 Important-1）。
  const templateDeskIndexes = cell.desks.map((desk) => (stage2 ? resolveChecklistPrepTemplateDeskIndex(desk, input.template, dayOfWeek, cell.slotNumber) : null))
  const seats = cell.desks.map((desk, deskIndex) => {
    const seat = findTemplateSingleLessonSeat(context, desk)
    if (seat == null) return null
    if (!stage2) return seat
    const templateDeskIndex = templateDeskIndexes[deskIndex]
    if (templateDeskIndex == null) return null
    // 盤面の席とテンプレの席が同じ並び（テンプレの生徒が同じ席に居る）机だけ。盤面は生徒 1 の居ないテンプレの机を [生徒 2, 空] に詰めて置くので、
    // ずれた机の席 2 に登録すると盤面では別の席に出る。
    const templateDesk = findChecklistPrepTemplateDesk(input.template, dayOfWeek, cell.slotNumber, templateDeskIndex)
    const studentSeat = seat === 0 ? 1 : 0
    if (templateDesk?.students[studentSeat]?.studentId !== desk.lesson?.studentSlots[studentSeat]?.managedStudentId) return null
    if (isChecklistPrepTemplateSeatTaken(input.template, dayOfWeek, cell.slotNumber, templateDeskIndex, seat)) return null
    return seat
  })
  const firstIndex = seats.findIndex((seat) => seat != null)
  if (firstIndex < 0) return null
  const secondIndex = seats.findIndex((seat, index) => index !== firstIndex && seat != null && (!stage2 || templateDeskIndexes[index] !== templateDeskIndexes[firstIndex]))
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
  const firstTemplateDeskIndex = templateDeskIndexes[firstIndex] ?? firstIndex + 1
  const secondTemplateDeskIndex = templateDeskIndexes[secondIndex] ?? secondIndex + 1
  const templateRegistrations: ChecklistPrepTemplateRegistration[] = stage2
    ? [
        { dayOfWeek, slotNumber: cell.slotNumber, deskIndex: firstIndex, templateDeskIndex: firstTemplateDeskIndex, studentIndex: firstSeat as 0 | 1, subject: profile.subject, label: '(1)', factKey: 'A' },
        { dayOfWeek, slotNumber: cell.slotNumber, deskIndex: secondIndex, templateDeskIndex: secondTemplateDeskIndex, studentIndex: secondSeat as 0 | 1, subject: profile.subject, label: '(2)' },
      ]
    : []
  // 結果の文のテンプレの席はテンプレの机番号で書く（「通常授業テンプレ作成」で見る番号）。
  const manualTodo = `残る手作業（必須）: 「通常授業テンプレ作成」で ${templateSeatLabel(cell, firstIndex, firstSeat)} と ${templateSeatLabel(cell, secondIndex, secondSeat)} の両方に誰かを登録して、テンプレを保存してください。`
  const templateLine = stage2
    ? `テンプレの (1)・(2) の席に確認用の生徒を登録して保存します（${templateSeatLabel(cell, firstTemplateDeskIndex - 1, firstSeat)} と ${templateSeatLabel(cell, secondTemplateDeskIndex - 1, secondSeat)}）。${afterSave}`
    : `${manualTodo}${afterSave}`
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
    // 項目の文（mn-1・tp-66）: (1) の机・手で置いた講師（X）・テンプレの講師（Y）・(1) の体験。(1) の席の確認用の生徒（A）は登録の後で足す。
    facts: { desk1: deskText(firstIndex), X: replacementName, Y: previousTeacher, trial: firstName },
    ...(stage2 ? {} : { todo: manualTodo }),
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// 第 3 段（§E-2-4-3・2026-11-07）: テンプレへ講師を登録する項目（tp-59・tp-69・tp-70）
// ─────────────────────────────────────────────────────────────────────────────

/**
 * 盤面のテンプレの机が、テンプレの中身のある机（机番号の順）と同じ位置に並んでいるか。テンプレの生徒の居る机は授業 id か生徒
 * （resolveChecklistPrepTemplateDeskIndex）で、講師だけの机はテンプレの講師（呼び名の対応表）で見る。
 */
function boardDeskMatchesTemplateDesk(desk: DeskCell, templateDesk: RegularLessonTemplateDesk, input: ChecklistPrepInput, aliases: TeacherAliasResolver, dayOfWeek: number, slotNumber: number) {
  if (templateDesk.students.some((student) => Boolean(student?.studentId))) {
    return resolveChecklistPrepTemplateDeskIndex(desk, input.template, dayOfWeek, slotNumber) === templateDesk.deskIndex
  }
  const teacher = input.teachers.find((entry) => entry.id === templateDesk.teacherId)
  if (!teacher || !desk.teacher.trim() || resolveDeskTeacherOrigin(desk) !== 'template') return false
  return teacherKeys(teacher, aliases).has(desk.teacher.trim())
}

type PackedTemplateSlot = {
  /** 新しく登録するテンプレの机番号（1 始まり・中身のある机より後ろの、講師も生徒も居ない最初の机）。 */
  templateDeskIndex: number
  /** その机が保存後に入る盤面の机（0 始まり＝テンプレの中身のある机の数）。 */
  landingDeskIndex: number
  /** その曜日・時限のテンプレの講師（準備の講師に選ばない）。 */
  templateTeacherIds: string[]
  dayOfWeek: number
}

/**
 * テンプレの机と盤面の机の対応（第 3 段・計画 §2「テンプレの机番号と盤面の机の対応は、テンプレ保存の差分反映が実際に置く机で決める」）。
 * 盤面はテンプレの中身のある机を机番号の順に**詰めて**置く（buildManagedScheduleCellsForRange）。そのため中身のある机の**後ろ**の空き机へ登録すれば、
 * 保存後にその机は盤面の「中身のある机の数」番目（0 始まり）に入り、ほかのテンプレの机の位置は動かない（途中の空き机へ登録すると後ろの机が 1 つずれる）。
 * 盤面のテンプレの机がその並びのとき（並び替えていない・講師を替えていない）だけ使う。並び替えた週の机は差分反映の直前に戻されて手入力の机が動くので使わない。
 * ★この数え方は ScheduleBoardScreen の buildManagedScheduleCellsForRange（テンプレの行を机番号の順に最初の空き机へ詰める）の写し
 *   （regression-reviewer S-3）。向こうの詰め方を変えたら、ここも直す。食い違いは checklistPrepStage3.test.ts の
 *   「準備 → 実際のテンプレ保存（computeTemplateDiffApplyForBoard）→ 形」のテストが落ちて知らせる（途中の空き机・並び替えた盤面の形も固定）。
 */
function resolvePackedTemplateSlot(context: CellContext, input: ChecklistPrepInput, aliases: TeacherAliasResolver): PackedTemplateSlot | null {
  const packed = resolvePackedTemplateDesks(context, input, aliases, 1)
  if (!packed) return null
  return { templateDeskIndex: packed.templateDeskIndexes[0], landingDeskIndex: packed.landingDeskIndexes[0], templateTeacherIds: packed.templateTeacherIds, dayOfWeek: packed.dayOfWeek }
}

/** resolvePackedTemplateSlot の机 count 個版（第 4 段・tp-72 はテンプレの空き机を 2 つ続けて使う）。 */
export type PackedTemplateDesks = {
  /** 新しく登録するテンプレの机番号（1 始まり・中身のある机より後ろの空き机を番号の順に count 個）。 */
  templateDeskIndexes: number[]
  /** それぞれが保存後に入る盤面の机（0 始まり・中身のある机の数から順に）。前から順に登録したときの位置（i 番目は 0〜i-1 番目が登録済みのとき）。 */
  landingDeskIndexes: number[]
  templateTeacherIds: string[]
  dayOfWeek: number
}

/**
 * テンプレの中身のある机の後ろの空き机 count 個と、保存後にそれぞれが入る盤面の机（resolvePackedTemplateSlot の数え方と同じ・count=1 で同じ結果）。
 * 盤面のテンプレの机がテンプレの並びのときだけ（並び替えた週・講師を替えた机は使わない）。
 */
export function resolvePackedTemplateDesks(context: CellContext, input: ChecklistPrepInput, aliases: TeacherAliasResolver, count: number): PackedTemplateDesks | null {
  const dayOfWeek = resolveCellDayOfWeek(context.cell)
  const templateCell: RegularLessonTemplateCell | undefined = input.template?.cells.find((cell) => cell.dayOfWeek === dayOfWeek && cell.slotNumber === context.cell.slotNumber)
  if (!templateCell) return null
  const sorted = [...templateCell.desks].sort((left, right) => left.deskIndex - right.deskIndex)
  const content = sorted.filter(hasChecklistPrepTemplateDeskContent)
  const lastContentIndex = content.length > 0 ? content[content.length - 1].deskIndex : 0
  const free = sorted.filter((desk) => desk.deskIndex > lastContentIndex && !hasChecklistPrepTemplateDeskContent(desk)).slice(0, count)
  if (free.length < count) return null
  const landingDeskIndexes = free.map((_, index) => content.length + index)
  if (landingDeskIndexes.some((index) => index >= context.cell.desks.length)) return null
  if (!content.every((templateDesk, index) => boardDeskMatchesTemplateDesk(context.cell.desks[index], templateDesk, input, aliases, dayOfWeek, context.cell.slotNumber))) return null
  return { templateDeskIndexes: free.map((desk) => desk.deskIndex), landingDeskIndexes, templateTeacherIds: content.map((desk) => desk.teacherId).filter(Boolean), dayOfWeek }
}

export function templateDeskText(cell: SlotCell, templateDeskIndex: number) {
  const day = cell.dayLabel ? `${cell.dayLabel}曜 ` : ''
  return `${day}${cell.slotLabel} 机 ${templateDeskIndex}`
}

function hasPrepStudentFor(input: ChecklistPrepInput, dayOfWeek: number, slotNumber: number, needed: number) {
  if (needed <= 0 || !input.prepStudents) return true
  return listAvailableChecklistPrepStudents(input.template, dayOfWeek, slotNumber, input.prepStudents).length >= needed
}

// tp-69（手置き講師だけの机に、テンプレで別の講師と生徒）: 盤面の着地の机（空き机）に手置き講師 X だけ。テンプレの同じ机に別の講師 Y と確認用の生徒。
// 保存すると机は保留（緑）: 上の行＝Y＋確認用の生徒・講師欄の下の行＝X（手で置いた生徒は居ない）。
function planTp69(context: CellContext, input: ChecklistPrepInput, aliases: TeacherAliasResolver): CellPlan | null {
  const { cell } = context
  const slot = resolvePackedTemplateSlot(context, input, aliases)
  if (!slot || !isEmptyDesk(context, cell.desks[slot.landingDeskIndex])) return null
  if (!hasPrepStudentFor(input, slot.dayOfWeek, cell.slotNumber, CHECKLIST_PREP_TEMPLATE_STUDENT_COUNT['tp-69'])) return null
  const handTeacher = pickReplacementTeacher(context, input, aliases, slot.templateTeacherIds)
  if (!handTeacher) return null
  const templateTeacher = pickReplacementTeacher(context, input, aliases, [...slot.templateTeacherIds, handTeacher.id])
  if (!templateTeacher) return null
  const profile = input.trialProfile ?? DEFAULT_TRIAL_PROFILE
  const deskIndex = slot.landingDeskIndex
  const handName = getTeacherDisplayName(handTeacher)
  const templateName = getTeacherDisplayName(templateTeacher)
  return {
    deskIndex,
    ops: [{ kind: 'manual-teacher', cellId: cell.id, deskIndex, teacherName: handName, teacherId: handTeacher.id }],
    lines: [
      `${cellLabel(cell)} 机 ${deskIndex + 1} に講師 ${handName} を手で置きました（生徒は置いていません）。`,
      `テンプレの ${templateDeskText(cell, slot.templateDeskIndex)} に講師 ${templateName} と確認用の生徒を登録して保存します。保存すると机 ${deskIndex + 1} は緑の保留になります（上の行＝${templateName}と確認用の生徒・講師欄の下の行＝${handName}）。`,
    ],
    templateRegistrations: [{ dayOfWeek: slot.dayOfWeek, slotNumber: cell.slotNumber, deskIndex, templateDeskIndex: slot.templateDeskIndex, studentIndex: 0, subject: profile.subject, label: '', factKey: 'A' }],
    templateTeacherRegistrations: [{ dayOfWeek: slot.dayOfWeek, slotNumber: cell.slotNumber, deskIndex, templateDeskIndex: slot.templateDeskIndex, teacherId: templateTeacher.id, teacherName: templateName, label: '' }],
    // 項目の文（tp-69）: 机・手で置いた講師（X）・テンプレの講師（Y）。確認用の生徒（A）は登録の後で足す。
    facts: { deskA: deskText(deskIndex), X: handName, Y: templateName },
  }
}

// tp-70（講師だけのテンプレ机と同じ机に手置き講師と手で置いた生徒）: 盤面の着地の机に手置き講師 X と体験。テンプレの同じ机に別の講師 Y だけ。
// 保存すると体験は席に 1 行のまま（生徒の席は緑にならない）、講師欄だけ上＝Y・下＝X の緑。
function planTp70(context: CellContext, input: ChecklistPrepInput, aliases: TeacherAliasResolver, serials: { trial: number; memo: number }): CellPlan | null {
  const { cell } = context
  const slot = resolvePackedTemplateSlot(context, input, aliases)
  if (!slot || !isEmptyDesk(context, cell.desks[slot.landingDeskIndex])) return null
  const handTeacher = pickReplacementTeacher(context, input, aliases, slot.templateTeacherIds)
  if (!handTeacher) return null
  const templateTeacher = pickReplacementTeacher(context, input, aliases, [...slot.templateTeacherIds, handTeacher.id])
  if (!templateTeacher) return null
  const profile = input.trialProfile ?? DEFAULT_TRIAL_PROFILE
  const deskIndex = slot.landingDeskIndex
  const trialName = `${CHECKLIST_PREP_TRIAL_NAME_PREFIX}${serials.trial}`
  const handName = getTeacherDisplayName(handTeacher)
  const templateName = getTeacherDisplayName(templateTeacher)
  return {
    deskIndex,
    ops: [
      { kind: 'manual-teacher', cellId: cell.id, deskIndex, teacherName: handName, teacherId: handTeacher.id },
      { kind: 'trial', cellId: cell.id, deskIndex, studentIndex: 0, name: trialName, grade: profile.grade, subject: profile.subject },
    ],
    lines: [
      `${cellLabel(cell)} 机 ${deskIndex + 1} に講師 ${handName} を手で置き、生徒 1 に体験「${trialName}」を置きました。`,
      `テンプレの ${templateDeskText(cell, slot.templateDeskIndex)} に講師 ${templateName} だけを登録して保存します（生徒は登録しません）。保存すると体験は席に 1 行のまま、机 ${deskIndex + 1} の講師欄だけが緑の 2 行になります（上＝${templateName}・下＝${handName}）。`,
    ],
    templateRegistrations: [],
    templateTeacherRegistrations: [{ dayOfWeek: slot.dayOfWeek, slotNumber: cell.slotNumber, deskIndex, templateDeskIndex: slot.templateDeskIndex, teacherId: templateTeacher.id, teacherName: templateName, label: '' }],
    // 項目の文（tp-70）: 机・手で置いた講師（X）・テンプレの講師（Y）・体験。
    facts: { deskA: deskText(deskIndex), X: handName, Y: templateName, trial: trialName },
  }
}

// tp-59（手置き講師 X の机があるコマで、テンプレが別の机に X を生徒つきで置く）: 盤面の机 A（着地の机より後ろの空き机）に X と体験。
// テンプレの机 B（保存後に盤面の着地の机に入る）に X と確認用の生徒。保存すると A は X＋体験の 1 行、B は確認用の生徒だけで講師欄は空（手入力が勝つ）。
function planTp59(context: CellContext, input: ChecklistPrepInput, aliases: TeacherAliasResolver, serials: { trial: number; memo: number }): CellPlan | null {
  const { cell } = context
  const slot = resolvePackedTemplateSlot(context, input, aliases)
  if (!slot || !isEmptyDesk(context, cell.desks[slot.landingDeskIndex])) return null
  // 机 A は着地の机より後ろ（テンプレが使わない位置）の空き机。前はテンプレの机なので使えない。
  const deskA = cell.desks.findIndex((desk, index) => index > slot.landingDeskIndex && isEmptyDesk(context, desk))
  if (deskA < 0) return null
  if (!hasPrepStudentFor(input, slot.dayOfWeek, cell.slotNumber, CHECKLIST_PREP_TEMPLATE_STUDENT_COUNT['tp-59'])) return null
  const teacher = pickReplacementTeacher(context, input, aliases, slot.templateTeacherIds)
  if (!teacher) return null
  const profile = input.trialProfile ?? DEFAULT_TRIAL_PROFILE
  const trialName = `${CHECKLIST_PREP_TRIAL_NAME_PREFIX}${serials.trial}`
  const teacherName = getTeacherDisplayName(teacher)
  const deskB = slot.landingDeskIndex
  return {
    deskIndex: deskA,
    ops: [
      { kind: 'manual-teacher', cellId: cell.id, deskIndex: deskA, teacherName, teacherId: teacher.id },
      { kind: 'trial', cellId: cell.id, deskIndex: deskA, studentIndex: 0, name: trialName, grade: profile.grade, subject: profile.subject },
    ],
    lines: [
      `机 A（${cellLabel(cell)} 机 ${deskA + 1}）に講師 ${teacherName} を手で置き、生徒 1 に体験「${trialName}」を置きました。`,
      `机 B（テンプレの ${templateDeskText(cell, slot.templateDeskIndex)}）に講師 ${teacherName} と確認用の生徒を登録して保存します（保存後はコマ表の机 ${deskB + 1} に入ります）。保存すると机 A は ${teacherName} と体験の 1 行のまま、机 B は確認用の生徒だけが入り講師欄は空になります。`,
    ],
    templateRegistrations: [{ dayOfWeek: slot.dayOfWeek, slotNumber: cell.slotNumber, deskIndex: deskB, templateDeskIndex: slot.templateDeskIndex, studentIndex: 0, subject: profile.subject, label: '机 B', factKey: 'A' }],
    templateTeacherRegistrations: [{ dayOfWeek: slot.dayOfWeek, slotNumber: cell.slotNumber, deskIndex: deskB, templateDeskIndex: slot.templateDeskIndex, teacherId: teacher.id, teacherName, label: '机 B' }],
    // 項目の文（tp-59）: 机 A（手で置いた講師と体験）・机 B（保存後にテンプレの机が入る盤面の机）・講師（X）・体験。机 B の確認用の生徒（A）は登録の後で足す。
    facts: { deskA: deskText(deskA), deskB: deskText(deskB), X: teacherName, trial: trialName },
  }
}

const ITEM_PLANNERS: Record<Exclude<ChecklistPrepItemId, ChecklistPrepSequenceItemId>, typeof planV21> = {
  'v2-1': planV21,
  'tp-64': planTp64,
  // mn-1（緑の机のメニューとハイライト）・tp-66（講師欄の下の行の見え方）は tp-64 と同じ形（(1) の机が講師欄も席も緑 2 行）を使い回す。
  'mn-1': planTp64,
  'tp-66': planTp64,
  'tp-69': planTp69,
  'tp-70': planTp70,
  'tp-59': planTp59,
}

const ITEM_NOT_FOUND_REASONS: Record<Exclude<ChecklistPrepItemId, ChecklistPrepSequenceItemId>, string> = {
  'v2-1': '講師も授業も無い空き机が 3 つあるコマ',
  'tp-64': 'テンプレの講師と生徒 1 人だけの机が 2 つあるコマ',
  'mn-1': 'テンプレの講師と生徒 1 人だけの机が 2 つあるコマ',
  'tp-66': 'テンプレの講師と生徒 1 人だけの机が 2 つあるコマ',
  'tp-69': 'テンプレの机の次に空き机があり、テンプレにも空いている机があるコマ',
  'tp-70': 'テンプレの机の次に空き机があり、テンプレにも空いている机があるコマ',
  'tp-59': 'テンプレの机の次に空き机が 2 つあり、テンプレにも空いている机があるコマ',
}

/** 準備の置き場と操作を決める（純関数・weeks は書き換えない）。 */
export function planChecklistPrep(input: ChecklistPrepInput): ChecklistPrepPlan {
  if (!isChecklistPrepItemId(input.itemId)) return { ok: false, reason: CHECKLIST_PREP_UNKNOWN_ITEM_MESSAGE }
  if (TEMPLATE_ONLY_ITEM_IDS.has(input.itemId) && !input.template) return { ok: false, reason: CHECKLIST_PREP_TEMPLATE_REQUIRED_MESSAGE }
  // 第 4 段の項目は段を続けて行うので、ここ（1 回の盤面の操作＋テンプレ保存）では決めない（コマ表は planChecklistPrepSequenceStep へ回す）。
  if (isChecklistPrepSequenceItemId(input.itemId)) return { ok: false, reason: CHECKLIST_PREP_UNKNOWN_ITEM_MESSAGE }
  const itemId = input.itemId
  const aliases = input.teacherAliases ?? defaultAliases
  const serials = {
    trial: nextSerial(input.weeks, (desk) => (desk.lesson?.studentSlots ?? []).map((student) => student?.name), CHECKLIST_PREP_TRIAL_NAME_PREFIX),
    memo: nextSerial(input.weeks, (desk) => desk.memoSlots ?? [], CHECKLIST_PREP_MEMO_PREFIX),
  }
  const planner = ITEM_PLANNERS[itemId]
  for (const context of listCandidateCells(input)) {
    const planned = planner(context, input, aliases, serials)
    if (!planned) continue
    const facts: ChecklistPrepPlanFacts = { ...planned.facts, slot: cellLabel(context.cell) }
    return {
      ok: true,
      dateKey: context.cell.dateKey,
      weekIndex: context.weekIndex,
      cellId: context.cell.id,
      deskIndex: planned.deskIndex,
      ops: planned.ops,
      templateRegistrations: planned.templateRegistrations,
      templateTeacherRegistrations: planned.templateTeacherRegistrations ?? [],
      message: [...planned.lines, CHECKLIST_PREP_SAVE_REMINDER].join('\n'),
      doneMessage: buildChecklistPrepDoneMessage({ slot: facts.slot, templateSaved: false, todo: planned.todo }),
      facts,
    }
  }
  const earliest = resolveChecklistPrepEarliestDateKey(input.todayKey, input.effectiveStartDate)
  return {
    ok: false,
    reason: `${earliest} 以降の表示できる週に、${ITEM_NOT_FOUND_REASONS[itemId]}${checklistPrepNeedsTemplate(itemId) && input.template !== undefined ? '（テンプレの机に引けて、テンプレの同じ席も空いている机）' : ''}が見つかりませんでした（休校日・保留（2 行）の机・出欠記録のある机は使いません）。何も変えていません。`,
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
          // 準備で置いた講師の印（後片づけの見分け・§E-2-4-2）。setManualTeacherAssignment は印を外すので、その後で付ける。
          desk.checklistPrepTeacher = true
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
  // 第 2 段: 名簿の使える確認用の生徒が項目の数より少なければ何も置かない（App が名簿へ足してからリクエストを立てる＝足し忘れ）。
  if (checklistPrepNeedsTemplate(request.itemId) && input.template !== undefined && input.prepStudents
    && input.prepStudents.filter(isUsableChecklistPrepStudent).length < CHECKLIST_PREP_TEMPLATE_STUDENT_COUNT[request.itemId]) {
    return { kind: 'finish', ok: false, message: CHECKLIST_PREP_STUDENTS_MISSING_MESSAGE }
  }
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
