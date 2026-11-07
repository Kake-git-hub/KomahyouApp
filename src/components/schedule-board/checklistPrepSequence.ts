// 確認リストの「準備する」第 4 段（docs/plan-2026-11-07-checklist-auto-prep-stage3.md §6・2026-11-07 オーナー回答
// 「残りの項目にも生徒や講師の配置の前提条件が必要な場合、準備するをつけて」）の純関数。対象は tp-71・tp-72・tp-75・v2-3・v2-6。
//
// ★段を続けて行う: 「テンプレに確認用の生徒を登録して保存 → 盤面の操作（移動・休み・未消化振替の配置・体験）→ もう一度テンプレに登録して保存」。
//   段の中身は最初の段（state=null）で全部決めて state に持ち、コマ表の effect は 1 レンダーに 1 段だけ当てる（前の段の setWeeks が入った次のレンダーで続き）。
// ★盤面の操作は室長の操作と同じ純関数を通す（operations に渡す: computeStudentMove〔メニューの移動・長押し D&D〕・computeStudentAbsentMark
//   〔メニューの「休み」〕・computeMakeupStockPlacement〔未消化振替の一覧から置く〕）。出自の印・在庫の台帳・削除記録は室長の操作と同じに付く
//   （commitWeeks が印を付ける）。ここで状態を直接書き換えない。
// ★会計（INV-06）: 動かすのは確認用の生徒だけ（オーナー回答「確認用の生徒に限り、準備で休み・振替を動かしてよい」）。ほかの生徒の席には置かない・
//   入れ替え（swap）にならないよう、置く先の席が空であることを当てる直前にもう一度確かめる（INV-02）。
// ★確かめたい操作そのもの（何も変えないテンプレ保存・丸ごと振替と解除）は手で行う（準備はその手前まで）。
// このファイルは純データ・純関数のみ（DOM / ネットワーク / React に触らない）。

import type { StudentRow, TeacherRow } from '../basic-data/basicDataModel'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { ClassroomSettings } from '../../types/appState'
import type { RegularLessonTemplate } from '../regular-template/regularLessonTemplate'
import {
  applyChecklistPrepOps,
  cellLabel,
  pickReplacementTeacher,
  isEmptyDesk,
  isSeatEmpty,
  listCandidateCells,
  resolveChecklistPrepEarliestDateKey,
  resolveCellDayOfWeek,
  resolvePackedTemplateDesks,
  isChecklistPrepSequenceItemId,
  CHECKLIST_PREP_NOT_VERIFICATION_MESSAGE,
  CHECKLIST_PREP_TEMPLATE_MODE_MESSAGE,
  CHECKLIST_PREP_TEMPLATE_REQUIRED_MESSAGE,
  CHECKLIST_PREP_TEMPLATE_STUDENT_COUNT,
  CHECKLIST_PREP_UNKNOWN_ITEM_MESSAGE,
  type CellContext,
  type ChecklistPrepInput,
  type ChecklistPrepPlanFacts,
  type ChecklistPrepSequenceItemId,
} from './checklistPrep'
import {
  CHECKLIST_PREP_TRIAL_NAME_PREFIX,
  CHECKLIST_PREP_STUDENTS_MISSING_MESSAGE,
  buildChecklistPrepDoneMessage,
  isUsableChecklistPrepStudent,
  describeChecklistPrepTemplateRegistered,
  listAvailableChecklistPrepStudents,
  type ChecklistPrepTemplateAssignment,
  type ChecklistPrepTemplateRegistration,
  type ChecklistPrepTemplateTeacherRegistration,
} from './checklistPrepTemplate'
import { getTeacherDisplayName } from '../basic-data/basicDataModel'
import { buildMakeupStockEntries, resolveRemainingOriginToken } from './makeupStock'
import type { applyClassroomAvailability, computeMakeupStockPlacement, computeStudentAbsentMark, computeStudentMove, StudentAbsentMarkLedgers } from './ScheduleBoardScreen'
import type { TeacherAliasResolver } from './templateDiffApply'
import { buildTemplatePendingDeskKey, type TemplatePendingDeskMap } from './templatePendingDesks'
import { cellsHaveNonDerivedStatusEntries, findWholeDayTransferPairForDate } from './wholeDayTransferPair'
import type { DeskCell, GradeLabel, SlotCell, SubjectLabel } from './types'

/**
 * 盤面の操作（室長の操作と同じ純関数）。コマ表は ScheduleBoardScreen の CHECKLIST_PREP_BOARD_OPERATIONS を渡す（テストも同じものを渡す）。
 * 渡すのは循環 import を避けるため（このファイルは型だけを ScheduleBoardScreen から読む）。
 */
export type ChecklistPrepBoardOperations = {
  computeStudentMove: typeof computeStudentMove
  computeStudentAbsentMark: typeof computeStudentAbsentMark
  computeMakeupStockPlacement: typeof computeMakeupStockPlacement
  applyClassroomAvailability: typeof applyClassroomAvailability
}

/** コマ表が 1 レンダーごとに渡す今の盤面と台帳（commitWeeks・未消化振替の一覧と同じ入力）。 */
export type ChecklistPrepSequenceEnv = {
  /** 盤面の weeks（commitWeeks に渡す生の週）。 */
  weeks: SlotCell[][]
  /** 開校ルール適用後の週（weeks と同じ並び）。休校日の判定・置き場の選び方はこちらで見る。 */
  normalizedWeeks: SlotCell[][]
  todayKey: string
  effectiveStartDate: string
  templatePendingDesks: TemplatePendingDeskMap | null
  teachers: readonly TeacherRow[]
  teacherAliases?: TeacherAliasResolver
  /** 今のテンプレ（在籍で絞った保存の基準・resolveTemplateDiffBaseline）。 */
  template: RegularLessonTemplate | null
  /** 名簿（確認用の生徒を含む）。 */
  students: readonly StudentRow[]
  regularLessons: RegularLessonRow[]
  classroomSettings: ClassroomSettings
  ledgers: StudentAbsentMarkLedgers
  ledgerMakeupOriginDatesByKey: Record<string, string[]>
  managedStudentByAnyName: Map<string, StudentRow>
  resolveDisplayName: (name: string) => string
  resolveStockId: (student: { managedStudentId?: string; name: string; manualAdded?: boolean }) => string
  createStudentId: (cellId: string, deskIndex: number, studentIndex: number) => string
  /** 体験の学年・科目（無ければ 中1・英）。 */
  trialProfile?: { grade: GradeLabel; subject: SubjectLabel }
  operations: ChecklistPrepBoardOperations
  now?: number
}

/** 盤面の席（週の番号つき）。 */
export type ChecklistPrepSeatRef = { cellId: string; dateKey: string; slotNumber: number; weekIndex: number; deskIndex: number; studentIndex: 0 | 1 }

export type ChecklistPrepSequenceBoardOp =
  /** 確認用の生徒 studentId（管理生徒 ID）を cellId のコマから to へ動かす（computeStudentMove・入れ替えにはしない）。 */
  | { kind: 'move'; studentId: string; fromCellId: string; to: ChecklistPrepSeatRef }
  /** 確認用の生徒 studentId の cellId のコマの授業を「休み」にする（computeStudentAbsentMark・未消化振替 +1）。 */
  | { kind: 'absent'; studentId: string; cellId: string; weekIndex: number }
  /** 直前の「休み」で戻った未消化振替を to に置く（computeMakeupStockPlacement・未消化振替 −1）。 */
  | { kind: 'makeup'; studentId: string; to: ChecklistPrepSeatRef }
  /** 体験を 1 人置く（在庫中立・第 1 段と同じ applyChecklistPrepOps）。 */
  | { kind: 'trial'; to: ChecklistPrepSeatRef; name: string; grade: GradeLabel; subject: SubjectLabel }
  /** 空き机に講師を手で置く（講師メニューの「保存」と同じ書き込み・準備の印つき＝第 1 段と同じ applyChecklistPrepOps）。 */
  | { kind: 'manual-teacher'; to: ChecklistPrepSeatRef; teacherName: string; teacherId: string }

export type ChecklistPrepSequenceStep =
  // 第119版（2026-11-07）: 結果の文に保存の「詳細」を載せなくなったので、旧 detail の印は外した。
  | { kind: 'template'; registrations: ChecklistPrepTemplateRegistration[]; teacherRegistrations?: ChecklistPrepTemplateTeacherRegistration[] }
  | { kind: 'board'; ops: ChecklistPrepSequenceBoardOp[]; lines: string[] }

export type ChecklistPrepSequenceState = {
  itemId: ChecklistPrepSequenceItemId
  steps: ChecklistPrepSequenceStep[]
  /** 次に行う段の番号。 */
  step: number
  /** 盤面の操作のあとに表示する週・コマ・机（項目の目安の机）。 */
  anchor: { weekIndex: number; cellId: string; deskIndex: number }
  /**
   * 項目の文に差し込む準備の事実（第119版・2026-11-07 オーナー指示「今のシンプルにした文に、いつの誰を追記して」）。最初の段で全部決める
   * （確認用の生徒は段を決めるときに選ぶので名前も入る）。旧 intro（何をどこに作るかの文）の代わり。
   */
  facts: ChecklistPrepPlanFacts
  /** 行ったことの文（途中で止まったとき・取りやめたときの「ここまでに行ったこと」）。成功の結果の文には載せない。 */
  done: string[]
}

export type ChecklistPrepSequenceAction =
  | { kind: 'fail'; reason: string }
  /** 盤面の週がまだ無い日へ移る（週を作る）。移ったら次のレンダーで最初から決め直す。 */
  | { kind: 'jump'; dateKey: string }
  | { kind: 'template'; registrations: ChecklistPrepTemplateRegistration[]; teacherRegistrations: ChecklistPrepTemplateTeacherRegistration[]; state: ChecklistPrepSequenceState }
  | { kind: 'board'; weeks: SlotCell[][]; ledgers: StudentAbsentMarkLedgers; weekIndex: number; cellId: string; deskIndex: number; state: ChecklistPrepSequenceState }
  | { kind: 'done'; state: ChecklistPrepSequenceState }

export const CHECKLIST_PREP_SEQUENCE_FAILED_REMINDER = '盤面とテンプレはまだサーバーに保存していません。ここまでに行ったものは盤面とテンプレに残っています。「後片づけ」で準備を消せます。次の操作はまだ行えません。'
/** テンプレの差分反映が無い教室・テンプレがまだ無い教室（第 3 段の項目と同じ文）。 */
export const CHECKLIST_PREP_SEQUENCE_TEMPLATE_REQUIRED_MESSAGE = CHECKLIST_PREP_TEMPLATE_REQUIRED_MESSAGE
const DEFAULT_TRIAL_PROFILE: { grade: GradeLabel; subject: SubjectLabel } = { grade: '中1', subject: '英' }
const defaultAliases: TeacherAliasResolver = (key) => [key]

function shiftDateKey(dateKey: string, days: number) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, (month || 1) - 1, (day || 1) + days)).toISOString().slice(0, 10)
}

function seatText(cell: SlotCell, deskIndex: number, seat: number) {
  return `${cellLabel(cell)} 机 ${deskIndex + 1} の生徒 ${seat + 1}`
}

function seatRef(context: CellContext, deskIndex: number, studentIndex: 0 | 1 = 0): ChecklistPrepSeatRef {
  return { cellId: context.cell.id, dateKey: context.cell.dateKey, slotNumber: context.cell.slotNumber, weekIndex: context.weekIndex, deskIndex, studentIndex }
}

function studentName(env: ChecklistPrepSequenceEnv, studentId: string) {
  return env.students.find((student) => student.id === studentId)?.name.trim() ?? studentId
}

/** コマ（上の行・保留の下の行）にその生徒が居るか。 */
function cellHasStudent(cell: SlotCell, pendingDesks: TemplatePendingDeskMap | null, studentId: string) {
  return cell.desks.some((desk) => {
    if (desk.lesson?.studentSlots.some((student) => student?.managedStudentId === studentId)) return true
    if (desk.statusSlots?.some((entry) => entry?.managedStudentId === studentId)) return true
    const lower = pendingDesks?.[buildTemplatePendingDeskKey(cell.id, desk.id)]?.lower
    return Boolean(lower?.lesson?.studentSlots.some((student) => student?.managedStudentId === studentId))
  })
}

/**
 * その日のどこかのコマ（上の行・出欠記録・保留の下の行）にその生徒が居るか。準備で動かす・休みにする確認用の生徒は、その日にほかの授業の無い生徒を選ぶ
 * （同じ日に同じ生徒×科目の授業が 2 つあると、盤面の授業の id〔生徒_日付_科目〕が重なって移動が別の時限の授業を動かし、休みの未消化振替も
 * 時限なしの記録 2 件が 1 件に数えられる＝今の処理の制約。準備はその形を作らない）。
 */
function dateHasStudent(env: ChecklistPrepSequenceEnv, dateKey: string, studentId: string) {
  return cellsOfDate(env.normalizedWeeks, dateKey).some((cell) => cellHasStudent(cell, env.templatePendingDesks, studentId))
}

/** その日のコマ（開校ルール適用後）。 */
function cellsOfDate(weeks: SlotCell[][], dateKey: string) {
  return weeks.flatMap((week) => week.filter((cell) => cell.dateKey === dateKey))
}

function toInput(env: ChecklistPrepSequenceEnv, itemId: string): ChecklistPrepInput {
  return {
    itemId, weeks: env.normalizedWeeks, todayKey: env.todayKey, effectiveStartDate: env.effectiveStartDate, templatePendingDesks: env.templatePendingDesks,
    teachers: env.teachers, teacherAliases: env.teacherAliases, template: env.template, prepStudents: env.students,
  }
}

/** その曜日・時限すべてに登録の無い確認用の生徒（名前の順）。 */
function availableInAll(env: ChecklistPrepSequenceEnv, slots: ReadonlyArray<{ dayOfWeek: number; slotNumber: number }>): StudentRow[] {
  const lists = slots.map((slot) => listAvailableChecklistPrepStudents(env.template, slot.dayOfWeek, slot.slotNumber, env.students))
  return lists[0]?.filter((student) => lists.every((list) => list.some((entry) => entry.id === student.id))) ?? []
}

function registration(context: CellContext, templateDeskIndex: number, deskIndex: number, studentIndex: 0 | 1, studentId: string, subject: SubjectLabel): ChecklistPrepTemplateRegistration {
  return { dayOfWeek: resolveCellDayOfWeek(context.cell), slotNumber: context.cell.slotNumber, deskIndex, templateDeskIndex, studentIndex, subject, label: '', studentId }
}

/** 空き机（講師も授業もメモも記録も無い・保留でない）の番号。exclude の机は除く。 */
function emptyDeskIndexes(context: CellContext, exclude: readonly number[] = []) {
  return context.cell.desks.map((desk, index) => (!exclude.includes(index) && isEmptyDesk(context, desk) ? index : -1)).filter((index) => index >= 0)
}

type PlanResult = { steps: ChecklistPrepSequenceStep[]; anchor: ChecklistPrepSequenceState['anchor']; facts: ChecklistPrepPlanFacts }

function deskText(deskIndex: number) {
  return `机 ${deskIndex + 1}`
}

/** 日付だけ（「2/2(火)」・丸ごと振替は日付で選ぶ）。 */
function dayText(cell: SlotCell) {
  return `${cell.dateLabel}${cell.dayLabel ? `(${cell.dayLabel})` : ''}`
}

// tp-71: 確認用の生徒 A・B をテンプレの同じ机（席 1・席 2）に登録して保存 → A を同じ日の別の時限の空き机へ、B を同じコマの別の空き机へ動かす。
// 手で: 何も変えずにテンプレを保存して、A・B がテンプレの机へ戻る（動かした先は空く）のを見る。
function planTp71(env: ChecklistPrepSequenceEnv, contexts: CellContext[], aliases: TeacherAliasResolver): PlanResult | null {
  const input = toInput(env, 'tp-71')
  const subject = (env.trialProfile ?? DEFAULT_TRIAL_PROFILE).subject
  for (const context of contexts) {
    const packed = resolvePackedTemplateDesks(context, input, aliases, 1)
    if (!packed) continue
    const landing = packed.landingDeskIndexes[0]
    if (!isEmptyDesk(context, context.cell.desks[landing])) continue
    const [studentA, studentB] = availableInAll(env, [{ dayOfWeek: packed.dayOfWeek, slotNumber: context.cell.slotNumber }]).filter((student) => !dateHasStudent(env, context.cell.dateKey, student.id))
    if (!studentA || !studentB) continue
    const deskB = emptyDeskIndexes(context, [landing])[0]
    if (deskB === undefined) continue
    const other = contexts.find((entry) => entry.cell.dateKey === context.cell.dateKey && entry.cell.slotNumber !== context.cell.slotNumber
      && !cellHasStudent(entry.cell, env.templatePendingDesks, studentA.id) && emptyDeskIndexes(entry).length > 0)
    if (!other) continue
    const deskA = emptyDeskIndexes(other)[0]
    const templateDeskIndex = packed.templateDeskIndexes[0]
    return {
      anchor: { weekIndex: context.weekIndex, cellId: context.cell.id, deskIndex: landing },
      // 項目の文（tp-71）: コマ・A・B・テンプレの机（保存で 2 人が入る盤面の机）。
      facts: { slot: cellLabel(context.cell), A: studentA.name.trim(), B: studentB.name.trim(), deskT: deskText(landing) },
      steps: [
        { kind: 'template', registrations: [registration(context, templateDeskIndex, landing, 0, studentA.id, subject), registration(context, templateDeskIndex, landing, 1, studentB.id, subject)] },
        {
          kind: 'board',
          ops: [
            { kind: 'move', studentId: studentA.id, fromCellId: context.cell.id, to: seatRef(other, deskA) },
            { kind: 'move', studentId: studentB.id, fromCellId: context.cell.id, to: seatRef(context, deskB) },
          ],
          lines: [
            `A（${studentA.name.trim()}）を同じ日の別の時限 ${seatText(other.cell, deskA, 0)} へ動かしました（テンプレの位置は ${cellLabel(context.cell)} 机 ${landing + 1}）。`,
            `B（${studentB.name.trim()}）を同じコマの別の机 ${seatText(context.cell, deskB, 0)} へ動かしました（机替え）。`,
          ],
        },
      ],
    }
  }
  return null
}

// tp-72: 確認用の生徒 A をテンプレの机 T1 に登録して保存 → A を同じコマの次の机（テンプレの机 T2 が保存後に入る机）へ動かす →
// テンプレの T2 の同じ席に確認用の生徒 C を登録して保存。目安: その机は C の 1 行・A はテンプレの元の机。
function planTp72(env: ChecklistPrepSequenceEnv, contexts: CellContext[], aliases: TeacherAliasResolver): PlanResult | null {
  const input = toInput(env, 'tp-72')
  const subject = (env.trialProfile ?? DEFAULT_TRIAL_PROFILE).subject
  for (const context of contexts) {
    const packed = resolvePackedTemplateDesks(context, input, aliases, 2)
    if (!packed) continue
    const [landingA, landingC] = packed.landingDeskIndexes
    if (!isEmptyDesk(context, context.cell.desks[landingA]) || !isEmptyDesk(context, context.cell.desks[landingC])) continue
    const [studentA, studentC] = availableInAll(env, [{ dayOfWeek: packed.dayOfWeek, slotNumber: context.cell.slotNumber }]).filter((student) => !dateHasStudent(env, context.cell.dateKey, student.id))
    if (!studentA || !studentC) continue
    const [templateDeskA, templateDeskC] = packed.templateDeskIndexes
    return {
      anchor: { weekIndex: context.weekIndex, cellId: context.cell.id, deskIndex: landingC },
      // 項目の文（tp-72）: コマ・A・C・A のテンプレの机・C の机（A を動かした先）。
      facts: { slot: cellLabel(context.cell), A: studentA.name.trim(), C: studentC.name.trim(), deskA: deskText(landingA), deskC: deskText(landingC) },
      steps: [
        { kind: 'template', registrations: [registration(context, templateDeskA, landingA, 0, studentA.id, subject)] },
        {
          kind: 'board',
          ops: [{ kind: 'move', studentId: studentA.id, fromCellId: context.cell.id, to: seatRef(context, landingC) }],
          lines: [`A（${studentA.name.trim()}）を同じコマの ${seatText(context.cell, landingC, 0)} へ動かしました（机替え・テンプレの位置は机 ${landingA + 1}）。`],
        },
        { kind: 'template', registrations: [registration(context, templateDeskC, landingC, 0, studentC.id, subject)] },
      ],
    }
  }
  return null
}

// tp-75: 確認用の生徒 A を別の日のコマ（α・別の曜日か時限）のテンプレに登録して保存 → A の α の授業を「休み」（未消化振替 +1）→ その振替を
// このコマ（β）の空き机に置く → β のテンプレの別の机に A の通常授業を登録して保存。目安: 振替の机は A の 1 行のまま・テンプレの机に A は入らない。
function planTp75(env: ChecklistPrepSequenceEnv, contexts: CellContext[], aliases: TeacherAliasResolver): PlanResult | null {
  // 休みにする日は振替を置く日より前を先に探す（振替を元の日に置くと通常授業に戻る＝normalizeLessonPlacement なので、同じ日は使わない）。
  return planTp75Pass(env, contexts, aliases, (alpha, beta) => alpha < beta) ?? planTp75Pass(env, contexts, aliases, (alpha, beta) => alpha !== beta)
}

function planTp75Pass(env: ChecklistPrepSequenceEnv, contexts: CellContext[], aliases: TeacherAliasResolver, acceptsAbsenceDate: (alphaDateKey: string, betaDateKey: string) => boolean): PlanResult | null {
  const input = toInput(env, 'tp-75')
  const subject = (env.trialProfile ?? DEFAULT_TRIAL_PROFILE).subject
  for (const context of contexts) {
    const packedBeta = resolvePackedTemplateDesks(context, input, aliases, 1)
    if (!packedBeta) continue
    const landingBeta = packedBeta.landingDeskIndexes[0]
    if (!isEmptyDesk(context, context.cell.desks[landingBeta])) continue
    // 振替を置く机は、テンプレの机が入る机より後ろの空き机（テンプレの机と重ねない）。
    const makeupDesk = emptyDeskIndexes(context, [landingBeta]).find((index) => index > landingBeta)
    if (makeupDesk === undefined) continue
    for (const alpha of contexts) {
      if (!acceptsAbsenceDate(alpha.cell.dateKey, context.cell.dateKey)) continue
      const packedAlpha = resolvePackedTemplateDesks(alpha, input, aliases, 1)
      if (!packedAlpha) continue
      // 同じ曜日・時限のテンプレに 2 回登録しない（別の曜日か別の時限）。
      if (packedAlpha.dayOfWeek === packedBeta.dayOfWeek && alpha.cell.slotNumber === context.cell.slotNumber) continue
      const landingAlpha = packedAlpha.landingDeskIndexes[0]
      if (!isEmptyDesk(alpha, alpha.cell.desks[landingAlpha])) continue
      const [studentA] = availableInAll(env, [{ dayOfWeek: packedAlpha.dayOfWeek, slotNumber: alpha.cell.slotNumber }, { dayOfWeek: packedBeta.dayOfWeek, slotNumber: context.cell.slotNumber }])
        .filter((student) => !dateHasStudent(env, context.cell.dateKey, student.id) && !dateHasStudent(env, alpha.cell.dateKey, student.id))
      if (!studentA) continue
      const name = studentA.name.trim()
      return {
        anchor: { weekIndex: context.weekIndex, cellId: context.cell.id, deskIndex: makeupDesk },
        // 項目の文（tp-75）: コマ・A・振替の机・テンプレの机（A を登録しても入らない机）。
        facts: { slot: cellLabel(context.cell), A: name, deskM: deskText(makeupDesk), deskT: deskText(landingBeta) },
        steps: [
          { kind: 'template', registrations: [registration(alpha, packedAlpha.templateDeskIndexes[0], landingAlpha, 0, studentA.id, subject)] },
          {
            kind: 'board',
            ops: [
              { kind: 'absent', studentId: studentA.id, cellId: alpha.cell.id, weekIndex: alpha.weekIndex },
              { kind: 'makeup', studentId: studentA.id, to: seatRef(context, makeupDesk) },
            ],
            lines: [
              `${cellLabel(alpha.cell)} の A（${name}）を「休み」にしました（A の未消化振替 +1・メニューの「休み」と同じ処理）。`,
              `その振替を ${seatText(context.cell, makeupDesk, 0)} に置きました（未消化振替の一覧から置くのと同じ処理・A の未消化振替は元に戻る）。`,
            ],
          },
          { kind: 'template', registrations: [registration(context, packedBeta.templateDeskIndexes[0], landingBeta, 0, studentA.id, subject)] },
        ],
      }
    }
  }
  return null
}

/** 丸ごと振替の元・先に使える日か（出欠記録が無い・組が無い）。 */
function isWholeDayTransferReadyDate(env: ChecklistPrepSequenceEnv, dateKey: string) {
  if (cellsHaveNonDerivedStatusEntries(cellsOfDate(env.normalizedWeeks, dateKey))) return false
  return !findWholeDayTransferPairForDate(env.ledgers.suppressedRegularLessonOccurrences, dateKey)
}

// v2-6: 同じ曜日・同じ時限の 2 つの日 A（振替元）・B（1 週後・振替先）。確認用の生徒 C を別の曜日（か時限）のテンプレに登録して保存 →
// その日の C を「休み」（未消化振替 +1）→ その振替を B の空き机に置く・A の空き机に体験 → A・B の曜日・時限のテンプレに C を登録して保存。
// 保存後: A は C（テンプレ）と体験、B は C の振替だけ（手入力が先にあるのでテンプレの C は置かない）。手で: A の日付で「丸ごと振替」→ B で実行、解除。
function planV26(env: ChecklistPrepSequenceEnv, contexts: CellContext[], aliases: TeacherAliasResolver): PlanResult | null {
  const input = toInput(env, 'v2-6')
  const profile = env.trialProfile ?? DEFAULT_TRIAL_PROFILE
  for (const source of contexts) {
    const target = contexts.find((entry) => entry.cell.slotNumber === source.cell.slotNumber && entry.cell.dateKey === shiftDateKey(source.cell.dateKey, 7))
    if (!target) continue
    if (!isWholeDayTransferReadyDate(env, source.cell.dateKey) || !isWholeDayTransferReadyDate(env, target.cell.dateKey)) continue
    const packedSource = resolvePackedTemplateDesks(source, input, aliases, 1)
    const packedTarget = resolvePackedTemplateDesks(target, input, aliases, 1)
    if (!packedSource || !packedTarget || packedSource.templateDeskIndexes[0] !== packedTarget.templateDeskIndexes[0] || packedSource.landingDeskIndexes[0] !== packedTarget.landingDeskIndexes[0]) continue
    const landing = packedSource.landingDeskIndexes[0]
    if (!isEmptyDesk(source, source.cell.desks[landing]) || !isEmptyDesk(target, target.cell.desks[landing])) continue
    const makeupDesk = emptyDeskIndexes(target, [landing]).find((index) => index > landing)
    if (makeupDesk === undefined) continue
    // 体験の机は A・B の両方で空いている机（丸ごと振替で B の同じ机・同じ席へ移る）。
    const trialDesk = emptyDeskIndexes(source, [landing, makeupDesk]).find((index) => index > landing && isEmptyDesk(target, target.cell.desks[index]))
    if (trialDesk === undefined) continue
    const weekday = packedSource.dayOfWeek
    // 休みにする日: A・B 以外の日。別の曜日を先に探す（同じ曜日の別の時限だと A・B にも C の授業が増える）。
    const absenceCandidates = contexts
      .filter((entry) => entry.cell.dateKey !== source.cell.dateKey && entry.cell.dateKey !== target.cell.dateKey && !(resolveCellDayOfWeek(entry.cell) === weekday && entry.cell.slotNumber === source.cell.slotNumber))
      .sort((left, right) => Number(resolveCellDayOfWeek(left.cell) === weekday) - Number(resolveCellDayOfWeek(right.cell) === weekday))
    for (const absence of absenceCandidates) {
      const packedAbsence = resolvePackedTemplateDesks(absence, input, aliases, 1)
      if (!packedAbsence) continue
      const landingAbsence = packedAbsence.landingDeskIndexes[0]
      if (!isEmptyDesk(absence, absence.cell.desks[landingAbsence])) continue
      const [studentC] = availableInAll(env, [{ dayOfWeek: packedAbsence.dayOfWeek, slotNumber: absence.cell.slotNumber }, { dayOfWeek: weekday, slotNumber: source.cell.slotNumber }])
        .filter((student) => ![source, target, absence].some((entry) => dateHasStudent(env, entry.cell.dateKey, student.id)))
      if (!studentC) continue
      const name = studentC.name.trim()
      const trialName = `${CHECKLIST_PREP_TRIAL_NAME_PREFIX}${nextTrialSerial(env.weeks)}`
      return {
        anchor: { weekIndex: source.weekIndex, cellId: source.cell.id, deskIndex: trialDesk },
        // 項目の文（v2-6）: 振替元の日（A）・振替先の日（B・1 週後）・確認用の生徒 C・体験。丸ごと振替は日付で選ぶので日付だけ。
        facts: { slot: `${dayText(source.cell)}・${dayText(target.cell)} ${source.cell.slotLabel}`, dayA: dayText(source.cell), dayB: dayText(target.cell), C: name, trial: trialName },
        steps: [
          { kind: 'template', registrations: [registration(absence, packedAbsence.templateDeskIndexes[0], landingAbsence, 0, studentC.id, profile.subject)] },
          {
            kind: 'board',
            ops: [
              { kind: 'absent', studentId: studentC.id, cellId: absence.cell.id, weekIndex: absence.weekIndex },
              { kind: 'makeup', studentId: studentC.id, to: seatRef(target, makeupDesk) },
              { kind: 'trial', to: seatRef(source, trialDesk), name: trialName, grade: profile.grade, subject: profile.subject },
            ],
            lines: [
              `${cellLabel(absence.cell)} の C（${name}）を「休み」にしました（C の未消化振替 +1・メニューの「休み」と同じ処理）。`,
              `その振替を B の ${seatText(target.cell, makeupDesk, 0)} に置きました（未消化振替の一覧から置くのと同じ処理）。`,
              `A の ${seatText(source.cell, trialDesk, 0)} に体験「${trialName}」を置きました。`,
            ],
          },
          { kind: 'template', registrations: [registration(source, packedSource.templateDeskIndexes[0], landing, 0, studentC.id, profile.subject)] },
        ],
      }
    }
  }
  return null
}

// v2-3（3 つの形を 1 つのコマにまとめて作る）: コマ S（日 D）のテンプレの机の後ろの空き机 4 つ（P・K・L_A・L_X の順に保存後に入る）を使う。
//  (1) 緑の下の行に振替の生徒 A: A を別の日のコマ（α）のテンプレに登録して保存 → α の A を休み → その振替を P に置く → P のテンプレの机に確認用の生徒 Q を
//      登録して保存（P は上＝Q・下＝A の振替の緑）。
//  (2) 手置き講師 X の机: K に講師 X を手で置く。
//  (3) 同じ日の中で動かして休みにした授業: 確認用の生徒 R を D の別の時限 r1 のテンプレに登録して保存 → D の R を r2 の空き机へ動かして休み。
//  最後に A を L_A のテンプレの机に・X を L_X のテンプレの机に・K のテンプレの机に別の講師 W を登録して保存。手で: 何も変えずにもう一度保存。
function planV23(env: ChecklistPrepSequenceEnv, contexts: CellContext[], aliases: TeacherAliasResolver): PlanResult | null {
  const input = toInput(env, 'v2-3')
  const subject = (env.trialProfile ?? DEFAULT_TRIAL_PROFILE).subject
  for (const context of contexts) {
    const packed = resolvePackedTemplateDesks(context, input, aliases, 4)
    if (!packed) continue
    const [landingP, landingK, landingA, landingX] = packed.landingDeskIndexes
    if (![landingP, landingK, landingA, landingX].every((index) => isEmptyDesk(context, context.cell.desks[index]))) continue
    const [templateP, templateK, templateA, templateX] = packed.templateDeskIndexes
    const sameDay = contexts.filter((entry) => entry.cell.dateKey === context.cell.dateKey && entry.cell.slotNumber !== context.cell.slotNumber)
    for (const moveFrom of sameDay) {
      const packedR = resolvePackedTemplateDesks(moveFrom, input, aliases, 1)
      if (!packedR || !isEmptyDesk(moveFrom, moveFrom.cell.desks[packedR.landingDeskIndexes[0]])) continue
      const moveTo = sameDay.find((entry) => entry.cell.slotNumber !== moveFrom.cell.slotNumber && emptyDeskIndexes(entry).length > 0)
      if (!moveTo) continue
      const moveToDesk = emptyDeskIndexes(moveTo)[0]
      // A の休みの日は D より前を先に探す（振替を元の日に置くと通常授業に戻る）。
      const absenceCells = [...contexts.filter((entry) => entry.cell.dateKey < context.cell.dateKey), ...contexts.filter((entry) => entry.cell.dateKey > context.cell.dateKey)]
      for (const absence of absenceCells) {
        const packedAbsence = resolvePackedTemplateDesks(absence, input, aliases, 1)
        if (!packedAbsence || !isEmptyDesk(absence, absence.cell.desks[packedAbsence.landingDeskIndexes[0]])) continue
        if (packedAbsence.dayOfWeek === packed.dayOfWeek && absence.cell.slotNumber === context.cell.slotNumber) continue
        const slotS = { dayOfWeek: packed.dayOfWeek, slotNumber: context.cell.slotNumber }
        const notOnBoard = (student: StudentRow) => ![context, absence].some((entry) => dateHasStudent(env, entry.cell.dateKey, student.id))
        const studentA = availableInAll(env, [slotS, { dayOfWeek: packedAbsence.dayOfWeek, slotNumber: absence.cell.slotNumber }]).filter(notOnBoard)[0]
        if (!studentA) continue
        const studentQ = availableInAll(env, [slotS]).filter((student) => student.id !== studentA.id && notOnBoard(student))[0]
        const studentR = availableInAll(env, [{ dayOfWeek: packedR.dayOfWeek, slotNumber: moveFrom.cell.slotNumber }]).filter((student) => student.id !== studentA.id && student.id !== studentQ?.id && notOnBoard(student))[0]
        if (!studentQ || !studentR) continue
        const teacherX = pickReplacementTeacher(context, input, aliases, packed.templateTeacherIds)
        if (!teacherX) continue
        const teacherW = pickReplacementTeacher(context, input, aliases, [...packed.templateTeacherIds, teacherX.id])
        if (!teacherW) continue
        const nameX = getTeacherDisplayName(teacherX)
        const nameW = getTeacherDisplayName(teacherW)
        const [nameA, nameR] = [studentA, studentR].map((student) => student.name.trim())
        const cell = context.cell
        const teacherRegistration = (templateDeskIndex: number, deskIndex: number, teacher: { id: string; name: string }): ChecklistPrepTemplateTeacherRegistration => ({ dayOfWeek: packed.dayOfWeek, slotNumber: cell.slotNumber, deskIndex, templateDeskIndex, teacherId: teacher.id, teacherName: teacher.name, label: '' })
        return {
          anchor: { weekIndex: context.weekIndex, cellId: cell.id, deskIndex: landingP },
          // 項目の文（v2-3）: コマ・A（緑の下の行から上がる生徒）とテンプレの机・緑の机（P）・手置き講師 X の机（K）と X・別の講師 W・R と R の元のコマ。
          facts: {
            slot: cellLabel(cell), A: nameA, X: nameX, W: nameW, R: nameR,
            deskA: deskText(landingA), deskP: deskText(landingP), deskK: deskText(landingK), rFrom: cellLabel(moveFrom.cell),
          },
          steps: [
            { kind: 'template', registrations: [registration(absence, packedAbsence.templateDeskIndexes[0], packedAbsence.landingDeskIndexes[0], 0, studentA.id, subject), registration(moveFrom, packedR.templateDeskIndexes[0], packedR.landingDeskIndexes[0], 0, studentR.id, subject)] },
            {
              kind: 'board',
              ops: [
                { kind: 'absent', studentId: studentA.id, cellId: absence.cell.id, weekIndex: absence.weekIndex },
                { kind: 'makeup', studentId: studentA.id, to: seatRef(context, landingP) },
                { kind: 'manual-teacher', to: seatRef(context, landingK), teacherName: nameX, teacherId: teacherX.id },
                { kind: 'move', studentId: studentR.id, fromCellId: moveFrom.cell.id, to: seatRef(moveTo, moveToDesk) },
                { kind: 'absent', studentId: studentR.id, cellId: moveTo.cell.id, weekIndex: moveTo.weekIndex },
              ],
              lines: [
                `${cellLabel(absence.cell)} の A（${nameA}）を「休み」にし、その振替を ${seatText(cell, landingP, 0)} に置きました（メニューの「休み」・未消化振替の一覧から置くのと同じ処理）。`,
                `${cellLabel(cell)} 机 ${landingK + 1} に講師 ${nameX} を手で置きました。`,
                `${cellLabel(moveFrom.cell)} の R（${nameR}）を同じ日の ${seatText(moveTo.cell, moveToDesk, 0)} へ動かし、そこで「休み」にしました（R の未消化振替 +1）。`,
              ],
            },
            { kind: 'template', registrations: [registration(context, templateP, landingP, 0, studentQ.id, subject)] },
            {
              kind: 'template',
              registrations: [registration(context, templateA, landingA, 0, studentA.id, subject)],
              teacherRegistrations: [teacherRegistration(templateK, landingK, { id: teacherW.id, name: nameW }), teacherRegistration(templateX, landingX, { id: teacherX.id, name: nameX })],
            },
          ],
        }
      }
    }
  }
  return null
}

function nextTrialSerial(weeks: SlotCell[][]) {
  let max = 0
  for (const week of weeks) for (const cell of week) for (const desk of cell.desks) for (const student of desk.lesson?.studentSlots ?? []) {
    if (!student?.name.startsWith(CHECKLIST_PREP_TRIAL_NAME_PREFIX)) continue
    const serial = Number(student.name.slice(CHECKLIST_PREP_TRIAL_NAME_PREFIX.length).trim())
    if (Number.isFinite(serial) && serial > max) max = serial
  }
  return max + 1
}

const SEQUENCE_PLANNERS: Record<ChecklistPrepSequenceItemId, (env: ChecklistPrepSequenceEnv, contexts: CellContext[], aliases: TeacherAliasResolver) => PlanResult | null> = {
  'tp-71': planTp71,
  'tp-72': planTp72,
  'tp-75': planTp75,
  'v2-3': planV23,
  'v2-6': planV26,
}

const SEQUENCE_NOT_FOUND: Record<ChecklistPrepSequenceItemId, string> = {
  'tp-71': 'テンプレの机の次に空き机が 2 つあり、同じ日の別の時限にも空き机があるコマ',
  'tp-72': 'テンプレの机の次に空き机が 2 つ続き、テンプレにも空いている机が 2 つ続くコマ',
  'tp-75': 'テンプレの机の次に空き机が 2 つあり、別の日のコマのテンプレの机の次も空いているコマ',
  'v2-3': 'テンプレの机の次に空き机が 4 つ続き、同じ日の別の 2 つの時限と別の日のコマにも空き机があるコマ',
  'v2-6': '同じ曜日・時限の 1 週ちがいの 2 日（どちらも出欠記録と丸ごと振替が無い）で、テンプレの机の次に空き机が 3 つあるコマ',
}

/** 盤面の席の今の生徒（確認用の生徒 studentId の上の行の授業）。 */
function findStudentSeat(weeks: SlotCell[][], cellId: string, studentId: string): { weekIndex: number; deskIndex: number; studentIndex: 0 | 1; entryId: string } | null {
  for (let weekIndex = 0; weekIndex < weeks.length; weekIndex += 1) {
    const cell = weeks[weekIndex].find((entry) => entry.id === cellId)
    if (!cell) continue
    for (let deskIndex = 0; deskIndex < cell.desks.length; deskIndex += 1) {
      const slots = cell.desks[deskIndex].lesson?.studentSlots ?? [null, null]
      for (const studentIndex of [0, 1] as const) {
        const student = slots[studentIndex]
        if (student?.managedStudentId === studentId) return { weekIndex, deskIndex, studentIndex, entryId: student.id }
      }
    }
  }
  return null
}

/** 置く先の席が空いているか（生徒・メモ・記録が無い・保留の机でない）。入れ替え（swap）で別の生徒を動かさないため、当てる直前に確かめる（INV-02）。 */
function isTargetSeatFree(weeks: SlotCell[][], pendingDesks: TemplatePendingDeskMap | null, to: ChecklistPrepSeatRef): DeskCell | null {
  const cell = weeks[to.weekIndex]?.find((entry) => entry.id === to.cellId)
  const desk = cell?.desks[to.deskIndex]
  if (!cell || !desk) return null
  if (pendingDesks?.[buildTemplatePendingDeskKey(cell.id, desk.id)]) return null
  return isSeatEmpty(desk, to.studentIndex) ? desk : null
}

type BoardWork = { weeks: SlotCell[][]; ledgers: StudentAbsentMarkLedgers; lastAbsent: { stockKey: string; originDate: string; originSlotNumber: number | null } | null }

/** 盤面の段を当てる（純関数・入力は書き換えない）。1 つでも当てられなければ理由を返す（盤面は変えない＝段ごとに全部か無し）。 */
function applyBoardOps(env: ChecklistPrepSequenceEnv, ops: readonly ChecklistPrepSequenceBoardOp[]): { ok: true; work: BoardWork } | { ok: false; reason: string } {
  const { operations } = env
  let work: BoardWork = { weeks: env.weeks, ledgers: env.ledgers, lastAbsent: null }
  for (const op of ops) {
    if (op.kind === 'move') {
      const seat = findStudentSeat(work.weeks, op.fromCellId, op.studentId)
      if (!seat) return { ok: false, reason: `${studentName(env, op.studentId)} がテンプレの位置に見つかりませんでした。` }
      if (!isTargetSeatFree(work.weeks, env.templatePendingDesks, op.to)) return { ok: false, reason: `動かす先の席が空いていません（${op.to.dateKey} ${op.to.slotNumber}限 机 ${op.to.deskIndex + 1}）。` }
      // computeStudentMove は授業の id で動かす生徒を探す。同じ id の授業がほかにもあると別の授業を動かすので、当てない（INV-02）。
      const sameIdCount = work.weeks.flat().reduce((count, cell) => count + cell.desks.reduce((deskCount, desk) => deskCount + (desk.lesson?.studentSlots.filter((student) => student?.id === seat.entryId).length ?? 0), 0), 0)
      if (sameIdCount !== 1) return { ok: false, reason: `${studentName(env, op.studentId)} は同じ日に同じ科目の授業がほかにもあるため動かしませんでした。` }
      const result = operations.computeStudentMove({
        weeks: work.weeks,
        weekIndex: op.to.weekIndex,
        cells: operations.applyClassroomAvailability(work.weeks, env.classroomSettings)[op.to.weekIndex] ?? [],
        movingStudentId: seat.entryId,
        cellId: op.to.cellId,
        deskIndex: op.to.deskIndex,
        studentIndex: op.to.studentIndex,
        suppressedRegularLessonOccurrences: work.ledgers.suppressedRegularLessonOccurrences,
        managedStudentByAnyName: env.managedStudentByAnyName,
        resolveBoardStudentDisplayName: env.resolveDisplayName,
        templateOriginRules: true,
      })
      if (result.status !== 'moved') return { ok: false, reason: result.message }
      // 上書きで消える記録は出ない（空いている席にだけ動かす）。出たら台帳の確定が要るので当てない（INV-06）。
      if (result.displacedStatusEntries.length > 0) return { ok: false, reason: '動かすと別の生徒の出欠記録を上書きするため動かしませんでした。' }
      work = { ...work, weeks: result.nextWeeks, ledgers: { ...work.ledgers, suppressedRegularLessonOccurrences: result.nextSuppressedRegularLessonOccurrences } }
      continue
    }
    if (op.kind === 'absent') {
      const seat = findStudentSeat(work.weeks, op.cellId, op.studentId)
      if (!seat) return { ok: false, reason: `${studentName(env, op.studentId)} の休みにする授業が見つかりませんでした。` }
      const result = operations.computeStudentAbsentMark({
        weeks: work.weeks,
        weekIndex: seat.weekIndex,
        seat: { cellId: op.cellId, deskIndex: seat.deskIndex, studentIndex: seat.studentIndex },
        ...work.ledgers,
        ledgerOriginDatesByKey: env.ledgerMakeupOriginDatesByKey,
        managedStudentByAnyName: env.managedStudentByAnyName,
        resolveDisplayName: env.resolveDisplayName,
        resolveStockId: env.resolveStockId,
        // 確認リストの準備は開発用教室（機能フラグ templateDiffApply が ON）で動く＝上の移動と同じく第 2 版の抑止キーの決め方（INV-12 2026-11-07）。
        templateOriginRules: true,
      })
      if (!result || result.kind !== 'makeup-returned' || !result.makeupStock) return { ok: false, reason: `${studentName(env, op.studentId)} の授業を休みにできませんでした。` }
      work = { weeks: result.nextWeeks, ledgers: result.ledgers, lastAbsent: result.makeupStock }
      continue
    }
    if (op.kind === 'makeup') {
      const absent = work.lastAbsent
      if (!absent) return { ok: false, reason: '置く振替がありません。' }
      const normalized = operations.applyClassroomAvailability(work.weeks, env.classroomSettings)
      const targetCell = normalized[op.to.weekIndex]?.find((entry) => entry.id === op.to.cellId)
      if (!targetCell?.isOpenDay) return { ok: false, reason: '振替を置くコマが休校日です。' }
      if (!isTargetSeatFree(work.weeks, env.templatePendingDesks, op.to)) return { ok: false, reason: `振替を置く席が空いていません（${op.to.dateKey} ${op.to.slotNumber}限 机 ${op.to.deskIndex + 1}）。` }
      // 未消化振替の一覧（rawMakeupStockEntries）と同じ入力で在庫を引く（休みで戻った分がその行の残りに入る）。
      const entries = buildMakeupStockEntries({
        students: [...env.students], teachers: [...env.teachers], regularLessons: env.regularLessons, classroomSettings: env.classroomSettings, weeks: normalized,
        manualAdjustments: work.ledgers.manualMakeupAdjustments, suppressedOrigins: work.ledgers.suppressedMakeupOrigins, fallbackStudents: work.ledgers.fallbackMakeupStudents,
        resolveStudentKey: env.resolveStockId, templatePendingDesks: env.templatePendingDesks, wholeDayPairKeys: work.ledgers.suppressedRegularLessonOccurrences,
      })
      const entry = entries.find((item) => item.key === absent.stockKey)
      if (!entry || entry.balance <= 0) return { ok: false, reason: `${studentName(env, op.studentId)} の未消化振替が見つかりませんでした。` }
      const token = resolveRemainingOriginToken(entry, absent.originDate, absent.originSlotNumber)
      const placed = operations.computeMakeupStockPlacement({
        weeks: work.weeks, weekIndex: op.to.weekIndex, cellId: op.to.cellId, deskIndex: op.to.deskIndex, studentIndex: op.to.studentIndex,
        stockStudentKey: entry.studentId, stockDisplayName: entry.displayName, placementEntry: entry, selectedOriginToken: token, students: env.students,
        createStudentId: env.createStudentId, managedStudentByAnyName: env.managedStudentByAnyName, resolveDisplayName: env.resolveDisplayName,
      })
      if (placed.status !== 'placed') return { ok: false, reason: placed.status === 'blocked' ? placed.message : '振替を置く机が見つかりませんでした。' }
      work = { ...work, weeks: placed.nextWeeks, lastAbsent: null }
      continue
    }
    if (op.kind === 'manual-teacher') {
      // 講師も授業も無い机にだけ置く（今ある講師を替えない・INV-02）。
      const desk = work.weeks[op.to.weekIndex]?.find((entry) => entry.id === op.to.cellId)?.desks[op.to.deskIndex]
      if (!desk || desk.teacher.trim() || desk.lesson?.studentSlots.some(Boolean) || env.templatePendingDesks?.[buildTemplatePendingDeskKey(op.to.cellId, desk.id)]) {
        return { ok: false, reason: `講師を置く机が空いていません（${op.to.dateKey} ${op.to.slotNumber}限 机 ${op.to.deskIndex + 1}）。` }
      }
      const applied = applyChecklistPrepOps(work.weeks, [{ kind: 'manual-teacher', cellId: op.to.cellId, deskIndex: op.to.deskIndex, teacherName: op.teacherName, teacherId: op.teacherId }], env.teacherAliases, { now: env.now })
      if (applied.skipped > 0) return { ok: false, reason: '講師を置く机が見つかりませんでした。' }
      work = { ...work, weeks: applied.weeks }
      continue
    }
    if (!isTargetSeatFree(work.weeks, env.templatePendingDesks, op.to)) return { ok: false, reason: `体験を置く席が空いていません（${op.to.dateKey} ${op.to.slotNumber}限 机 ${op.to.deskIndex + 1}）。` }
    const applied = applyChecklistPrepOps(work.weeks, [{ kind: 'trial', cellId: op.to.cellId, deskIndex: op.to.deskIndex, studentIndex: op.to.studentIndex, name: op.name, grade: op.grade, subject: op.subject }], env.teacherAliases, { now: env.now })
    if (applied.skipped > 0) return { ok: false, reason: '体験を置く机が見つかりませんでした。' }
    work = { ...work, weeks: applied.weeks }
  }
  return { ok: true, work }
}

/**
 * 次の段を決める（純関数）。state が null なら最初の段（置き場を全部決める）。
 *  - template … 確認用の生徒をテンプレへ登録して保存する（コマ表が prepareChecklistPrepTemplateSave → 手で保存するときと同じ保存を通す）。
 *  - board …… 盤面の操作を当てた weeks と台帳（コマ表が commitWeeks に渡す）。
 *  - done …… 全部の段を行った。
 */
export function planChecklistPrepSequenceStep(itemId: string, state: ChecklistPrepSequenceState | null, env: ChecklistPrepSequenceEnv): ChecklistPrepSequenceAction {
  if (!isChecklistPrepSequenceItemId(itemId)) return { kind: 'fail', reason: CHECKLIST_PREP_UNKNOWN_ITEM_MESSAGE }
  if (!env.template) return { kind: 'fail', reason: CHECKLIST_PREP_SEQUENCE_TEMPLATE_REQUIRED_MESSAGE }
  let current = state
  if (!current) {
    const earliest = resolveChecklistPrepEarliestDateKey(env.todayKey, env.effectiveStartDate)
    // v2-6 は 1 週後の日も要る（盤面の週が無ければ作る）。
    const lastNeeded = itemId === 'v2-6' ? shiftDateKey(earliest, 7) : earliest
    if (!env.weeks.some((week) => week.some((cell) => cell.dateKey >= lastNeeded))) return { kind: 'jump', dateKey: lastNeeded }
    const planned = SEQUENCE_PLANNERS[itemId](env, listCandidateCells(toInput(env, itemId)), env.teacherAliases ?? defaultAliases)
    if (!planned) {
      return { kind: 'fail', reason: `${earliest} 以降の表示できる週に、${SEQUENCE_NOT_FOUND[itemId]}（確認用の生徒をテンプレに登録できる机）が見つかりませんでした（休校日・保留（2 行）の机・出欠記録のある机は使いません）。何も変えていません。` }
    }
    current = { itemId, steps: planned.steps, step: 0, anchor: planned.anchor, facts: planned.facts, done: [] }
  }
  const step = current.steps[current.step]
  if (!step) return { kind: 'done', state: current }
  if (step.kind === 'template') return { kind: 'template', registrations: step.registrations, teacherRegistrations: step.teacherRegistrations ?? [], state: current }
  const applied = applyBoardOps(env, step.ops)
  if (!applied.ok) return { kind: 'fail', reason: applied.reason }
  const next: ChecklistPrepSequenceState = { ...current, step: current.step + 1, done: [...current.done, ...step.lines] }
  return { kind: 'board', weeks: applied.work.weeks, ledgers: applied.work.ledgers, weekIndex: current.anchor.weekIndex, cellId: current.anchor.cellId, deskIndex: current.anchor.deskIndex, state: next }
}

/**
 * テンプレ保存の段が済んだ（登録した席の文を「ここまでに行ったこと」に足す）。第119版（2026-11-07）: 成功の結果の文に保存の「詳細」を載せなくなったので、
 * 保存の中身は受け取らない（確認画面の「詳細」は手で保存するときに見る）。
 */
export function recordChecklistPrepSequenceTemplateSaved(state: ChecklistPrepSequenceState, params: {
  assigned: readonly ChecklistPrepTemplateAssignment[]
  assignedTeachers?: readonly ChecklistPrepTemplateTeacherRegistration[]
}): ChecklistPrepSequenceState {
  return { ...state, step: state.step + 1, done: [...state.done, describeChecklistPrepTemplateRegistered(params.assigned, params.assignedTeachers)] }
}

export function isChecklistPrepSequenceComplete(state: ChecklistPrepSequenceState) {
  return state.step >= state.steps.length
}

/**
 * 全部の段を行ったときの結果の文（第119版・2026-11-07 オーナー指示「など細かい事象説明は不要。今のシンプルにした文に、いつの誰を追記して」）:
 * 「準備しました（日付 時限）。」＋テンプレ保存の後の一言の 2 行だけ。何を作ったか（いつ・どの机・誰）は state.facts で項目の文へ差し込む。
 */
export function buildChecklistPrepSequenceMessage(state: ChecklistPrepSequenceState): string {
  return buildChecklistPrepDoneMessage({ slot: state.facts.slot, templateSaved: true })
}

/** 途中の段で止まったときの文（行ったことは黙って消さずに書く・§E-2-4-2 安全）。最初の段より前なら理由だけ。 */
export function buildChecklistPrepSequenceFailedMessage(state: ChecklistPrepSequenceState | null, reason: string): string {
  if (!state || state.done.length === 0) return reason
  return [`途中で止めました: ${reason}`, 'ここまでに行ったこと:', ...state.done, CHECKLIST_PREP_SEQUENCE_FAILED_REMINDER].join('\n')
}

/** App の保険タイマー・取りやめで出す「ここまでに行ったこと」（進み具合の通知に載せる）。 */
export function summarizeChecklistPrepSequenceProgress(state: ChecklistPrepSequenceState): string {
  return state.done.join(' ')
}

/**
 * 段を続ける準備を始めてよいか（コマ表の effect の最初の判断・純関数）。検証用教室でない・テンプレ編集中・テンプレの差分反映の無い教室・
 * 名簿の確認用の生徒が足りない（App の足し忘れ）は断る（何も変えない）。断らなければ null。
 */
export function resolveChecklistPrepSequenceStartBlock(params: { itemId: ChecklistPrepSequenceItemId; isVerificationClassroom: boolean; isTemplateMode: boolean; templateDiffApplyEnabled: boolean; students: readonly StudentRow[] }): string | null {
  if (!params.isVerificationClassroom) return CHECKLIST_PREP_NOT_VERIFICATION_MESSAGE
  if (params.isTemplateMode) return CHECKLIST_PREP_TEMPLATE_MODE_MESSAGE
  if (!params.templateDiffApplyEnabled) return CHECKLIST_PREP_SEQUENCE_TEMPLATE_REQUIRED_MESSAGE
  if (params.students.filter(isUsableChecklistPrepStudent).length < CHECKLIST_PREP_TEMPLATE_STUDENT_COUNT[params.itemId]) return CHECKLIST_PREP_STUDENTS_MISSING_MESSAGE
  return null
}
