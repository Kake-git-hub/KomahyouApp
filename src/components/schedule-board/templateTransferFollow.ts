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
import { isCellInTemplateDiffScope, resolveDayOfWeekFromDateKey, buildTemplateSlotKey, type TemplateDiffSlotFilter } from './templateDefinitionDiff'
import { isClosedDate, parseOriginSlotNumberFromLabel } from './makeupStock'
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
  /** 振替元の時限（ラベルから取れないときは null＝その日のどの時限にも根拠が無いときだけ対象）。 */
  sourceSlotNumber: number | null
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

/**
 * 根拠を失った振替を集める（Q40-1）。対象は上段の生きている振替だけ（保留の下段・出欠記録・手動追加は見ない）。
 * 根拠 ＝ (a) 新テンプレ（抑止前）が振替元の日×時限にその生徒×科目の通常授業を持つ、または (b) その日×時限に会計を持つ出欠記録がある。
 */
export function collectOrphanedMakeups(params: {
  weeks: SlotCell[][]
  /** 新テンプレの管理セル（抑止前の raw を見る）。休日のコマは空になるので、根拠 (a) はテンプレ行（regularLessons）でも見る。 */
  templateCells: readonly TemplateDiffTemplateCell[]
  /** 新テンプレの通常授業の行（曜日×時限×生徒 ID）。休日設定した日でも「テンプレがその生徒を持つ」を判定するための正本。 */
  regularLessons: readonly RegularLessonRow[]
  effectiveStartDate: string
  slotFilter?: TemplateDiffSlotFilter | null
}): OrphanedMakeupRemoval[] {
  const rowStudentsBySlot = new Map<string, Set<string>>()
  const rowStudentsByDay = new Map<number, Set<string>>()
  for (const row of params.regularLessons) {
    for (const studentId of [row.student1Id, row.student2Id]) {
      if (!studentId) continue
      const slotKey = buildTemplateSlotKey(row.dayOfWeek, row.slotNumber)
      rowStudentsBySlot.set(slotKey, (rowStudentsBySlot.get(slotKey) ?? new Set<string>()).add(studentId))
      rowStudentsByDay.set(row.dayOfWeek, (rowStudentsByDay.get(row.dayOfWeek) ?? new Set<string>()).add(studentId))
    }
  }
  const templateByDateSlot = new Map<string, Set<string>>()
  const templateByDate = new Map<string, Set<string>>()
  for (const entry of params.templateCells) {
    const raw = entry.raw
    const keys = new Set<string>()
    for (const desk of raw.desks) for (const student of liveStudentsOf(desk)) keys.add(studentSubjectKey(student))
    templateByDateSlot.set(dateSlotKey(raw.dateKey, raw.slotNumber), keys)
    const byDate = templateByDate.get(raw.dateKey) ?? new Set<string>()
    for (const key of keys) byDate.add(key)
    templateByDate.set(raw.dateKey, byDate)
  }
  const accountingByDateSlot = new Map<string, Set<string>>()
  const accountingByDate = new Map<string, Set<string>>()
  for (const week of params.weeks) for (const cell of week) {
    for (const desk of cell.desks) for (const entry of desk.statusSlots ?? []) {
      if (!entry || !isAccountingStatus(entry.status)) continue
      const key = studentSubjectKey(entry)
      const slotKey = dateSlotKey(cell.dateKey, cell.slotNumber)
      accountingByDateSlot.set(slotKey, (accountingByDateSlot.get(slotKey) ?? new Set<string>()).add(key))
      accountingByDate.set(cell.dateKey, (accountingByDate.get(cell.dateKey) ?? new Set<string>()).add(key))
    }
  }
  const hasBasis = (student: StudentEntry, sourceDateKey: string, sourceSlotNumber: number | null) => {
    const key = studentSubjectKey(student)
    const dayOfWeek = resolveDayOfWeekFromDateKey(sourceDateKey)
    const studentId = student.managedStudentId
    if (sourceSlotNumber == null) {
      return Boolean(templateByDate.get(sourceDateKey)?.has(key) || accountingByDate.get(sourceDateKey)?.has(key) || (studentId && rowStudentsByDay.get(dayOfWeek)?.has(studentId)))
    }
    const slotKey = dateSlotKey(sourceDateKey, sourceSlotNumber)
    return Boolean(templateByDateSlot.get(slotKey)?.has(key) || accountingByDateSlot.get(slotKey)?.has(key) || (studentId && rowStudentsBySlot.get(buildTemplateSlotKey(dayOfWeek, sourceSlotNumber))?.has(studentId)))
  }

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
        if (hasBasis(student, sourceDateKey, sourceSlotNumber)) return
        removals.push({ cellId: cell.id, deskId: desk.id, seatIndex, student, sourceDateKey, sourceSlotNumber })
      })
    }
  }
  return removals
}

/** 根拠を失った振替を机から外し、振替元の移動元記録（moved）も消す。触ったセルの ID を返す（保存直後の再マージの重ね合わせに渡す）。 */
export function removeOrphanedMakeups(weeks: SlotCell[][], removals: readonly OrphanedMakeupRemoval[]): { weeks: SlotCell[][]; removedMovedRecords: number; touchedCellIds: Set<string> } {
  if (removals.length === 0) return { weeks, removedMovedRecords: 0, touchedCellIds: new Set() }
  const byDesk = new Map<string, OrphanedMakeupRemoval[]>()
  for (const removal of removals) {
    const key = `${removal.cellId}__${removal.deskId}`
    byDesk.set(key, [...(byDesk.get(key) ?? []), removal])
  }
  // 振替元の移動元記録: 日×時限（時限不明なら日）× 生徒×科目
  const movedTargets = new Map<string, Set<string>>()
  for (const removal of removals) {
    const key = removal.sourceSlotNumber == null ? removal.sourceDateKey : dateSlotKey(removal.sourceDateKey, removal.sourceSlotNumber)
    movedTargets.set(key, (movedTargets.get(key) ?? new Set<string>()).add(studentSubjectKey(removal.student)))
  }
  const touchedCellIds = new Set<string>()
  let removedMovedRecords = 0
  const nextWeeks = weeks.map((week) => week.map((cell) => {
    const movedKeys = new Set<string>([...(movedTargets.get(cell.dateKey) ?? []), ...(movedTargets.get(dateSlotKey(cell.dateKey, cell.slotNumber)) ?? [])])
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
  reason: 'no-seat' | 'pending-desk' | 'duplicate' | 'no-target-cell'
}

export type WholeDayTransferFollowPlan = {
  weeks: SlotCell[][]
  placed: WholeDayTransferPlacement[]
  stocked: WholeDayTransferStocked[]
  /** 希望回数 −1 から外す生徒（`${生徒×科目}__${日付}`）。置いた／未消化にした生徒。 */
  handledKeys: Set<string>
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
  const touchedCellIds = new Set<string>()
  if (params.skipped.length === 0) return { weeks: params.weeks, placed, stocked, handledKeys, touchedCellIds }

  // セルは参照で持ち替える（触ったセルだけ新しいオブジェクトに）。
  const cellById = new Map<string, SlotCell>()
  const weekIndexByCellId = new Map<string, [number, number]>()
  params.weeks.forEach((week, weekIndex) => week.forEach((cell, cellIndex) => { cellById.set(cell.id, cell); weekIndexByCellId.set(cell.id, [weekIndex, cellIndex]) }))
  const cellByDateSlot = new Map<string, string>()
  for (const cell of cellById.values()) cellByDateSlot.set(dateSlotKey(cell.dateKey, cell.slotNumber), cell.id)
  const replaceCell = (cell: SlotCell) => { cellById.set(cell.id, cell); touchedCellIds.add(cell.id) }

  const stock = (item: WholeDayTransferSkippedStudent, reason: WholeDayTransferStocked['reason']) => {
    stocked.push({ student: item.student, sourceDateKey: item.dateKey, sourceSlotNumber: item.slotNumber, ledger: !isClosedDate(item.dateKey, params.classroomSettings), reason })
    handledKeys.add(buildWholeDayTransferHandledKey(item.student, item.dateKey))
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
    const targetCellId = cellByDateSlot.get(dateSlotKey(destination.dateKey, destination.slotNumber))
    const targetCell = targetCellId ? cellById.get(targetCellId) : undefined
    if (!targetCell) { stock(item, 'no-target-cell'); continue }
    const targetDesk = targetCell.desks[item.deskIndex]
    if (!targetDesk) { stock(item, 'no-seat'); continue }
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

    // 振替元の日のテンプレの机に移動元記録（休)→ 先）を残す（丸ごと振替と同じ表示）。席が埋まっていれば記録は残さない（配置は成立）。
    const sourceCellId = cellByDateSlot.get(dateSlotKey(item.dateKey, item.slotNumber))
    const sourceCell = sourceCellId ? cellById.get(sourceCellId) : undefined
    const sourceDesk = sourceCell?.desks[item.deskIndex]
    if (sourceCell && sourceDesk) {
      const statusSeat = !sourceDesk.statusSlots?.[item.seatIndex] ? item.seatIndex : (!sourceDesk.statusSlots?.[item.seatIndex === 0 ? 1 : 0] ? (item.seatIndex === 0 ? 1 : 0) : -1)
      if (statusSeat >= 0) {
        const entry = params.buildMovedSourceStatusEntry({ student: item.student, sourceCell, sourceDesk, destinationDateKey: destination.dateKey, destinationSlotNumber: destination.slotNumber })
        const statusSlots = [...(sourceDesk.statusSlots ?? [null, null])] as StatusPair
        statusSlots[statusSeat] = entry
        replaceCell({ ...sourceCell, desks: sourceCell.desks.map((desk) => (desk === sourceDesk ? { ...sourceDesk, statusSlots } : desk)) })
      }
    }
  }

  if (touchedCellIds.size === 0) return { weeks: params.weeks, placed, stocked, handledKeys, touchedCellIds }
  const weeks = params.weeks.map((week) => {
    const next = week.map((cell) => cellById.get(cell.id) ?? cell)
    return next.some((cell, index) => cell !== week[index]) ? next : week
  })
  return { weeks, placed, stocked, handledKeys, touchedCellIds }
}

/** 保存直後の再マージの重ね合わせを、追従で触ったセルにも当てるための絞り込み。絞り込みが無い（全コマ）ならそのまま。 */
export function extendTemplateDiffSlotFilterWithCells(filter: TemplateDiffSlotFilter | null | undefined, cellIds: ReadonlySet<string>): TemplateDiffSlotFilter | null | undefined {
  if (!filter || cellIds.size === 0) return filter
  return { ...filter, cellIds: new Set([...(filter.cellIds ?? []), ...cellIds]) }
}

/** 曜日×時限の鍵（テスト・確認文で使う）。 */
export function sourceSlotKeyOf(dateKey: string, slotNumber: number) {
  return buildTemplateSlotKey(resolveDayOfWeekFromDateKey(dateKey), slotNumber)
}
