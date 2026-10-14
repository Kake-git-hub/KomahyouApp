// テンプレの生徒の増減を、丸ごと振替・休日の振替に追従させる純関数（spec-template-behavior §H Q40・Issue #75 段 2・オーナー確定 2026-10-14）。
//
// 1. 根拠を失った振替（外した生徒）: 振替元（makeupSourceDate × 時限）が反映日以降で、新テンプレ（抑止前）がその日×時限にその生徒×科目の
//    通常授業を持たず、盤面にその日×時限の会計を持つ出欠記録（欠席由来の在庫）も無い振替は、保存で机から外す。振替元の移動元記録（moved）も消す。
//    在庫台帳は触らない（発生も消化も消えるので残数は動かない・INV-06）。手動追加・出欠記録付き・保留の下段は触らない（オーナー確定 I）。
// 2. 丸ごと振替した日に足した生徒: Q35 が「置かなかった」テンプレの生徒のうち、その日が振替元（移動元記録がある）なら、振替先の同じ時限・
//    同じ机番号の空いた席へ振替として置く（丸ごと振替と同じ形・在庫中立）。置けなければ未消化（振替元が休日なら自動発生に任せ、
//    休日でなければ台帳に origin を 1 件積む＝INV-06 の唯一の例外・オーナー確定 H）。どちらも Q35-8 の希望回数 −1 は積まない。
//
// このファイルは純関数だけ。巨大コンポーネントの関数（prepareStudentForMove・buildMovedSourceStatusEntry）は引数で受ける（循環 import を避ける）。

import type { ClassroomSettings } from '../../types/appState'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'
import { isAccountingStatus, studentSubjectKey, type TemplateDiffTemplateCell } from './templateDiffApply'
import { isCellInTemplateDiffScope, resolveDayOfWeekFromDateKey, type TemplateDiffSlotFilter } from './templateDefinitionDiff'
import { isClosedDate, parseOriginSlotNumberFromLabel, type ManualMakeupOrigin } from './makeupStock'
import { buildTemplatePendingDeskKey, type TemplatePendingDeskMap } from './templatePendingDesks'

type StudentPair = [StudentEntry | null, StudentEntry | null]
type StatusPair = [StudentStatusEntry | null, StudentStatusEntry | null]

function liveStudentsOf(desk: DeskCell): StudentEntry[] {
  const slots: Array<StudentEntry | null> = desk.lesson?.studentSlots ?? [null, null]
  return slots.filter((student): student is StudentEntry => student != null)
}

function dateSlotKey(dateKey: string, slotNumber: number) {
  return `${dateKey}_${slotNumber}`
}

/** 生徒の同一性（INV-12 の二重配置判定＝科目を問わず同じ生徒）。 */
function studentIdentity(student: Pick<StudentEntry, 'managedStudentId' | 'name'>) {
  return student.managedStudentId ?? student.name
}

// ─────────────────────────────────────────────────────────────────────────────
// 1. 根拠を失った振替
// ─────────────────────────────────────────────────────────────────────────────

export type OrphanedMakeupRemoval = {
  cellId: string
  deskId: string
  seatIndex: number
  student: StudentEntry
  sourceDateKey: string
  /** 振替元の時限（ラベルから取れないときは null）。範囲の判定にだけ使う（根拠は日単位で見る・Q40-1）。 */
  sourceSlotNumber: number | null
}

/** Q40-2 が台帳へ積む未消化 origin の印（理由ラベル）。外した生徒の分を保存が取り下げる（M-2）ときの判別に使う。 */
export const TEMPLATE_TRANSFER_STOCK_REASON = 'テンプレ保存（丸ごと振替で置けなかった分）'

export type TemplateTransferLedgerRemoval = {
  stockKey: string
  dateKey: string
  slotNumber?: number
}

/** 振替元（日×時限）が「テンプレで変えたコマ」の範囲に入るか。時限が分からない振替元は、その曜日のどれかの時限が範囲なら入る。 */
function isSourceInScope(sourceDateKey: string, sourceSlotNumber: number | null, filter: TemplateDiffSlotFilter | null | undefined) {
  if (!filter) return true
  if (sourceSlotNumber != null) return isCellInTemplateDiffScope({ dateKey: sourceDateKey, slotNumber: sourceSlotNumber }, filter)
  if (filter.fullBeforeDate && sourceDateKey < filter.fullBeforeDate) return true
  if (filter.fullDates?.has(sourceDateKey)) return true
  const dayOfWeek = resolveDayOfWeekFromDateKey(sourceDateKey)
  for (const key of filter.slotKeys) if (key.startsWith(`${dayOfWeek}__`)) return true
  return false
}

export type OrphanedMakeupCollection = {
  removals: OrphanedMakeupRemoval[]
  /** Q40-2 が積んだ未消化 origin のうち、その生徒×科目がその曜日のテンプレから外れたもの（保存が取り下げる・M-2）。 */
  ledgerRemovals: TemplateTransferLedgerRemoval[]
}

/**
 * 根拠を失った振替を集める（Q40-1）。対象は上段の生きている振替だけ（保留の下段・出欠記録・手動追加は見ない）。
 * 根拠は**日単位**で見る（在庫の消化が同じ日付へフォールバックする `consumeOriginDates` と揃える。時限だけ変えたテンプレで振替を消さない＝監査 H-1）:
 *   (a) 新テンプレがその日（同じ曜日）にその生徒×科目の通常授業を持つ（管理セルの raw か、テンプレ行〔休日のコマは管理セルが空になるので行でも見る〕）
 *   (b) その日に会計を持つ出欠記録（休み・振無休・出席＝欠席由来の在庫）がある
 *   (c) 台帳（manualMakeupAdjustments）にその生徒×科目のその日の origin がある（在庫由来の振替。消すと origin が再浮上して誤増＝監査 H-2）
 * 科目は生徒×科目で見る（科目変更は「外す＋足す」＝監査 H-3。テンプレ行の科目は表示科目に解決済み）。
 */
export function collectOrphanedMakeups(params: {
  weeks: SlotCell[][]
  /** 新テンプレの管理セル（抑止前の raw を見る）。休日のコマは空になるので、根拠 (a) はテンプレ行（regularLessons）でも見る。 */
  templateCells: readonly TemplateDiffTemplateCell[]
  /** 新テンプレの通常授業の行（曜日×時限×生徒 ID×表示科目）。休日設定した日でも「テンプレがその生徒を持つ」を判定するための正本。 */
  regularLessons: readonly RegularLessonRow[]
  /** 在庫台帳（在庫由来の振替を消さないための根拠 (c)・M-2 の取り下げ対象）。 */
  manualMakeupAdjustments: Readonly<Record<string, readonly ManualMakeupOrigin[]>>
  /** 生徒×科目 → 台帳の鍵（保存と同じ関数を渡す）。 */
  resolveStockKey: (student: Pick<StudentEntry, 'managedStudentId' | 'name' | 'subject' | 'manualAdded'>) => string
  effectiveStartDate: string
  slotFilter?: TemplateDiffSlotFilter | null
}): OrphanedMakeupCollection {
  const rowKeysByDay = new Map<number, Set<string>>()
  for (const row of params.regularLessons) {
    for (const [studentId, subject] of [[row.student1Id, row.subject1], [row.student2Id, row.subject2]] as const) {
      if (!studentId) continue
      rowKeysByDay.set(row.dayOfWeek, (rowKeysByDay.get(row.dayOfWeek) ?? new Set<string>()).add(`${studentId}__${subject}`))
    }
  }
  const templateByDate = new Map<string, Set<string>>()
  for (const entry of params.templateCells) {
    const raw = entry.raw
    const byDate = templateByDate.get(raw.dateKey) ?? new Set<string>()
    for (const desk of raw.desks) for (const student of liveStudentsOf(desk)) byDate.add(studentSubjectKey(student))
    templateByDate.set(raw.dateKey, byDate)
  }
  const accountingByDate = new Map<string, Set<string>>()
  for (const week of params.weeks) for (const cell of week) {
    for (const desk of cell.desks) for (const entry of desk.statusSlots ?? []) {
      if (!entry || !isAccountingStatus(entry.status)) continue
      accountingByDate.set(cell.dateKey, (accountingByDate.get(cell.dateKey) ?? new Set<string>()).add(studentSubjectKey(entry)))
    }
  }
  const templateHas = (student: StudentEntry, dateKey: string) => {
    if (templateByDate.get(dateKey)?.has(studentSubjectKey(student))) return true
    const studentId = student.managedStudentId
    return Boolean(studentId && rowKeysByDay.get(resolveDayOfWeekFromDateKey(dateKey))?.has(`${studentId}__${student.subject}`))
  }
  const ledgerHas = (student: StudentEntry, dateKey: string) => (params.manualMakeupAdjustments[params.resolveStockKey(student)] ?? []).some((origin) => origin.dateKey === dateKey)
  const hasBasis = (student: StudentEntry, dateKey: string) => templateHas(student, dateKey) || Boolean(accountingByDate.get(dateKey)?.has(studentSubjectKey(student))) || ledgerHas(student, dateKey)

  const removals: OrphanedMakeupRemoval[] = []
  for (const week of params.weeks) for (const cell of week) {
    if (cell.dateKey < params.effectiveStartDate) continue
    for (const desk of cell.desks) {
      desk.lesson?.studentSlots.forEach((student, seatIndex) => {
        if (!student || student.lessonType !== 'makeup' || student.manualAdded || !student.makeupSourceDate) return
        const sourceDateKey = student.makeupSourceDate
        if (sourceDateKey < params.effectiveStartDate) return
        const sourceSlotNumber = parseOriginSlotNumberFromLabel(student.makeupSourceLabel) ?? null
        if (!isSourceInScope(sourceDateKey, sourceSlotNumber, params.slotFilter)) return
        if (hasBasis(student, sourceDateKey)) return
        removals.push({ cellId: cell.id, deskId: desk.id, seatIndex, student, sourceDateKey, sourceSlotNumber })
      })
    }
  }

  // M-2: Q40-2 が積んだ未消化 origin は、その生徒×科目がその曜日のテンプレから外れたら取り下げる（足す→外す、で台帳が元に戻る）。
  const ledgerRemovals: TemplateTransferLedgerRemoval[] = []
  for (const [stockKey, origins] of Object.entries(params.manualMakeupAdjustments)) {
    const separator = stockKey.lastIndexOf('__')
    if (separator < 0) continue
    const studentId = stockKey.slice(0, separator)
    const subject = stockKey.slice(separator + 2)
    for (const origin of origins) {
      if (origin.reasonLabel !== TEMPLATE_TRANSFER_STOCK_REASON || origin.dateKey < params.effectiveStartDate) continue
      if (!isSourceInScope(origin.dateKey, origin.slotNumber ?? null, params.slotFilter)) continue
      if (rowKeysByDay.get(resolveDayOfWeekFromDateKey(origin.dateKey))?.has(`${studentId}__${subject}`)) continue
      ledgerRemovals.push({ stockKey, dateKey: origin.dateKey, ...(origin.slotNumber != null ? { slotNumber: origin.slotNumber } : {}) })
    }
  }
  return { removals, ledgerRemovals }
}

/** 根拠を失った振替を机から外し、振替元の移動元記録（moved・その日のその生徒×科目）も消す。触ったセルの ID を返す（保存直後の再マージの重ね合わせに渡す）。 */
export function removeOrphanedMakeups(weeks: SlotCell[][], removals: readonly OrphanedMakeupRemoval[]): { weeks: SlotCell[][]; removedMovedRecords: number; touchedCellIds: Set<string> } {
  if (removals.length === 0) return { weeks, removedMovedRecords: 0, touchedCellIds: new Set() }
  const byDesk = new Map<string, OrphanedMakeupRemoval[]>()
  for (const removal of removals) {
    const key = `${removal.cellId}__${removal.deskId}`
    byDesk.set(key, [...(byDesk.get(key) ?? []), removal])
  }
  // 振替元の移動元記録: 日 × 生徒×科目（根拠と同じく日単位。時限だけ変えた写しを残さない）
  const movedTargets = new Map<string, Set<string>>()
  for (const removal of removals) {
    movedTargets.set(removal.sourceDateKey, (movedTargets.get(removal.sourceDateKey) ?? new Set<string>()).add(studentSubjectKey(removal.student)))
  }
  const touchedCellIds = new Set<string>()
  let removedMovedRecords = 0
  const nextWeeks = weeks.map((week) => week.map((cell) => {
    const movedKeys = movedTargets.get(cell.dateKey) ?? new Set<string>()
    let changed = false
    const desks = cell.desks.map((desk) => {
      let next = desk
      const deskRemovals = byDesk.get(`${cell.id}__${desk.id}`)
      if (deskRemovals && next.lesson) {
        const slots = [...next.lesson.studentSlots] as StudentPair
        for (const removal of deskRemovals) slots[removal.seatIndex] = null
        next = { ...next }
        if (slots.some(Boolean)) next.lesson = { ...next.lesson!, studentSlots: slots }
        else delete next.lesson
        changed = true
      }
      if (movedKeys.size > 0 && next.statusSlots?.some((entry) => entry && entry.status === 'moved' && movedKeys.has(studentSubjectKey(entry)))) {
        const statusSlots = next.statusSlots.map((entry) => (entry && entry.status === 'moved' && movedKeys.has(studentSubjectKey(entry)) ? (removedMovedRecords += 1, null) : entry)) as StatusPair
        next = { ...next }
        if (statusSlots.some(Boolean)) next.statusSlots = statusSlots
        else delete next.statusSlots
        changed = true
      }
      return next
    })
    if (!changed) return cell
    touchedCellIds.add(cell.id)
    return { ...cell, desks }
  }))
  return { weeks: nextWeeks, removedMovedRecords, touchedCellIds }
}

// ─────────────────────────────────────────────────────────────────────────────
// 2. 丸ごと振替した日に足した生徒
// ─────────────────────────────────────────────────────────────────────────────

/** Q35 の手順 0 で「丸ごと振替した日なので置かなかった」テンプレの生徒（テンプレの机番号・席つき）。 */
export type WholeDayTransferSkippedStudent = {
  student: StudentEntry
  dateKey: string
  slotNumber: number
  /** テンプレの机の位置（0 始まり）。 */
  deskIndex: number
  /** テンプレの席（0=生徒 1・1=生徒 2）。 */
  seatIndex: number
}

export type WholeDayTransferPlacement = {
  student: StudentEntry
  sourceDateKey: string
  sourceSlotNumber: number
  targetDateKey: string
  targetCellId: string
  deskId: string
  seatIndex: number
}

export type WholeDayTransferStocked = {
  student: StudentEntry
  sourceDateKey: string
  sourceSlotNumber: number
  /** true ＝ 台帳に origin を 1 件積む（振替元が休日でない）。false ＝ 休日・定休日なので自動の不足 origin に任せる。 */
  ledger: boolean
  reason: 'no-seat' | 'no-teacher' | 'pending-desk' | 'duplicate' | 'no-target-cell'
}

export type WholeDayTransferFollowPlan = {
  weeks: SlotCell[][]
  placed: WholeDayTransferPlacement[]
  stocked: WholeDayTransferStocked[]
  /** 希望回数 −1 から外す生徒（`${生徒×科目}__${日付}`）。置いた／未消化にした生徒。 */
  handledKeys: Set<string>
  /** 置いた／未消化にした件数（確認文の「置かず振替を優先 k 名」から引く数。同じ生徒が同じ日に 2 回スキップされても件数で数える・L-1）。 */
  handledCount: number
  touchedCellIds: Set<string>
}

export function buildWholeDayTransferHandledKey(student: Pick<StudentEntry, 'managedStudentId' | 'name' | 'subject'>, dateKey: string) {
  return `${studentSubjectKey(student)}__${dateKey}`
}

/** 振替元の日の移動元記録から振替先（日付・時限）を引く。同じ時限の記録を優先し、無ければその日のどれかの記録（時限は同じと見なす）。 */
export function resolveWholeDayTransferDestination(weeks: SlotCell[][], sourceDateKey: string, sourceSlotNumber: number): { dateKey: string; slotNumber: number } | null {
  let fallback: { dateKey: string; slotNumber: number } | null = null
  for (const week of weeks) for (const cell of week) {
    if (cell.dateKey !== sourceDateKey) continue
    for (const desk of cell.desks) for (const entry of desk.statusSlots ?? []) {
      if (!entry || entry.status !== 'moved' || !entry.moveDestinationDateKey) continue
      if (cell.slotNumber === sourceSlotNumber) return { dateKey: entry.moveDestinationDateKey, slotNumber: entry.moveDestinationSlotNumber ?? sourceSlotNumber }
      if (!fallback) fallback = { dateKey: entry.moveDestinationDateKey, slotNumber: sourceSlotNumber }
    }
  }
  return fallback
}

function isSeatFree(desk: DeskCell, seatIndex: number) {
  return !desk.lesson?.studentSlots[seatIndex] && !desk.statusSlots?.[seatIndex]
}

/**
 * Q40-2: 丸ごと振替した日（振替元）に足した生徒を振替先へ置く計画。置けない生徒は未消化（休日なら自動・休日でなければ台帳へ）。
 */
export function planWholeDayTransferPlacements(params: {
  weeks: SlotCell[][]
  skipped: readonly WholeDayTransferSkippedStudent[]
  pendingDesks: TemplatePendingDeskMap
  classroomSettings: ClassroomSettings
  /** 反映日。振替先が反映日より前（後ろ向きの丸ごと振替）なら触らない（INV-10・監査 H-4）。 */
  effectiveStartDate: string
  /**
   * 保存前から持っている通常授業の抑止キー。同じ生徒×科目×日付のキーが**別の時限**で積まれている生徒は、丸ごと振替の処分（−1 済み）か移送
   * （振替として別日で行う）で精算済みなので触らない（Q35-8 M-1 と同じ二重計上の防止）。
   */
  suppressedRegularLessonOccurrences: readonly string[]
  prepareStudentForMove: (student: StudentEntry, sourceDateKey: string, sourceSlotNumber: number, targetDateKey: string) => StudentEntry
  buildMovedSourceStatusEntry: (params: { student: StudentEntry; sourceCell: SlotCell; sourceDesk: DeskCell; destinationDateKey: string; destinationSlotNumber: number }) => StudentStatusEntry
}): WholeDayTransferFollowPlan {
  const placed: WholeDayTransferPlacement[] = []
  const stocked: WholeDayTransferStocked[] = []
  const handledKeys = new Set<string>()
  let handledCount = 0
  const touchedCellIds = new Set<string>()
  if (params.skipped.length === 0) return { weeks: params.weeks, placed, stocked, handledKeys, handledCount, touchedCellIds }

  // セルは参照で持ち替える（触ったセルだけ新しいオブジェクトに）。
  const cellById = new Map<string, SlotCell>()
  for (const week of params.weeks) for (const cell of week) cellById.set(cell.id, cell)
  const cellByDateSlot = new Map<string, string>()
  for (const cell of cellById.values()) cellByDateSlot.set(dateSlotKey(cell.dateKey, cell.slotNumber), cell.id)
  const replaceCell = (cell: SlotCell) => { cellById.set(cell.id, cell); touchedCellIds.add(cell.id) }

  const stock = (item: WholeDayTransferSkippedStudent, reason: WholeDayTransferStocked['reason']) => {
    stocked.push({ student: item.student, sourceDateKey: item.dateKey, sourceSlotNumber: item.slotNumber, ledger: !isClosedDate(item.dateKey, params.classroomSettings), reason })
    handledKeys.add(buildWholeDayTransferHandledKey(item.student, item.dateKey))
    handledCount += 1
  }

  const accountedOnDate = (student: StudentEntry, dateKey: string) => {
    const prefix = `${studentSubjectKey(student)}__${dateKey}__`
    return params.suppressedRegularLessonOccurrences.some((key) => key.startsWith(prefix))
  }

  for (const item of params.skipped) {
    if (accountedOnDate(item.student, item.dateKey)) continue
    const destination = resolveWholeDayTransferDestination(params.weeks, item.dateKey, item.slotNumber)
    // 移動元記録が無い日（振替先の日そのもの／2026-09-16 より前の古い丸ごと振替の振替元）は、振替先の日と区別できないので従来どおり Q35-8（置かず −1）に任せる。
    // 振替先の日は丸ごと振替の処分（全コマ削除と同一裁定＝通常授業は −1）と同じ扱いが筋。オーナー確定 K の「未消化扱い」は振替元の日（記録あり）で置けないときに当てる
    // （主セッション判断・異議があれば古い振替元も未消化へ）。
    if (!destination) continue
    // 後ろ向きの丸ごと振替（振替先が反映日より前）は反映日より前のセルに触れない（INV-10）。従来どおり Q35-8 に任せる。
    if (destination.dateKey < params.effectiveStartDate) continue
    const targetCellId = cellByDateSlot.get(dateSlotKey(destination.dateKey, destination.slotNumber))
    const targetCell = targetCellId ? cellById.get(targetCellId) : undefined
    if (!targetCell) { stock(item, 'no-target-cell'); continue }
    const targetDesk = targetCell.desks[item.deskIndex]
    if (!targetDesk) { stock(item, 'no-seat'); continue }
    // 講師のいない机には置かない（講師日程表に出ない授業を作らない・監査 M-4）。
    if (!targetDesk.teacher.trim()) { stock(item, 'no-teacher'); continue }
    if (params.pendingDesks[buildTemplatePendingDeskKey(targetCell.id, targetDesk.id)]) { stock(item, 'pending-desk'); continue }
    const identity = studentIdentity(item.student)
    if (targetCell.desks.some((desk) => liveStudentsOf(desk).some((student) => studentIdentity(student) === identity))) { stock(item, 'duplicate'); continue }
    const seatIndex = isSeatFree(targetDesk, item.seatIndex) ? item.seatIndex : (isSeatFree(targetDesk, item.seatIndex === 0 ? 1 : 0) ? (item.seatIndex === 0 ? 1 : 0) : -1)
    if (seatIndex < 0) { stock(item, 'no-seat'); continue }

    const moved = params.prepareStudentForMove({ ...item.student, id: `transfer_${item.dateKey}_${item.slotNumber}_${item.deskIndex}_${item.seatIndex}` }, item.dateKey, item.slotNumber, destination.dateKey)
    const slots = [...(targetDesk.lesson?.studentSlots ?? [null, null])] as StudentPair
    slots[seatIndex] = moved
    const nextTargetDesk: DeskCell = { ...targetDesk, lesson: targetDesk.lesson ? { ...targetDesk.lesson, studentSlots: slots } : { id: `daymove_${item.dateKey}_${item.slotNumber}_${item.deskIndex}`, studentSlots: slots } }
    replaceCell({ ...targetCell, desks: targetCell.desks.map((desk) => (desk === targetDesk ? nextTargetDesk : desk)) })
    placed.push({ student: item.student, sourceDateKey: item.dateKey, sourceSlotNumber: item.slotNumber, targetDateKey: destination.dateKey, targetCellId: targetCell.id, deskId: targetDesk.id, seatIndex })
    handledKeys.add(buildWholeDayTransferHandledKey(item.student, item.dateKey))
    handledCount += 1

    // 振替元の日のテンプレの机に移動元記録（休)→ 先）を残す（丸ごと振替と同じ表示）。席が埋まっていれば記録は残さない（配置は成立）。
    const sourceCellId = cellByDateSlot.get(dateSlotKey(item.dateKey, item.slotNumber))
    const sourceCell = sourceCellId ? cellById.get(sourceCellId) : undefined
    const sourceDesk = sourceCell?.desks[item.deskIndex]
    if (sourceCell && sourceDesk) {
      // 記録を置く席は授業も記録も無い席（isSeatFree と同じ判定・L-3）。
      const statusSeat = isSeatFree(sourceDesk, item.seatIndex) ? item.seatIndex : (isSeatFree(sourceDesk, item.seatIndex === 0 ? 1 : 0) ? (item.seatIndex === 0 ? 1 : 0) : -1)
      if (statusSeat >= 0) {
        const entry = params.buildMovedSourceStatusEntry({ student: item.student, sourceCell, sourceDesk, destinationDateKey: destination.dateKey, destinationSlotNumber: destination.slotNumber })
        const statusSlots = [...(sourceDesk.statusSlots ?? [null, null])] as StatusPair
        statusSlots[statusSeat] = entry
        replaceCell({ ...sourceCell, desks: sourceCell.desks.map((desk) => (desk === sourceDesk ? { ...sourceDesk, statusSlots } : desk)) })
      }
    }
  }

  if (touchedCellIds.size === 0) return { weeks: params.weeks, placed, stocked, handledKeys, handledCount, touchedCellIds }
  const weeks = params.weeks.map((week) => {
    const next = week.map((cell) => cellById.get(cell.id) ?? cell)
    return next.some((cell, index) => cell !== week[index]) ? next : week
  })
  return { weeks, placed, stocked, handledKeys, handledCount, touchedCellIds }
}

/** 保存直後の再マージの重ね合わせを、追従で触ったセルにも当てるための絞り込み。絞り込みが無い（全コマ）ならそのまま。 */
export function extendTemplateDiffSlotFilterWithCells(filter: TemplateDiffSlotFilter | null | undefined, cellIds: ReadonlySet<string>): TemplateDiffSlotFilter | null | undefined {
  if (!filter || cellIds.size === 0) return filter
  return { ...filter, cellIds: new Set([...(filter.cellIds ?? []), ...cellIds]) }
}
