// テンプレの生徒の増減を、丸ごと振替・休日の振替に追従させる純関数（spec-template-behavior §H Q40・Issue #75 段 2・オーナー確定 2026-10-14）。
//
// 1. 根拠を失った振替（外した生徒）: 振替元（makeupSourceDate）が反映日以降で、新テンプレ（抑止前）がその日（日単位）にその生徒×科目の通常授業を持たず、
//    在庫の正本（collectMakeupOriginDatesByKey＝台帳・振替の休みの記録・テンプレ行×休日の自動発生・保留の下段）もその日の origin を持たない振替は、
//    保存で机から外す。振替元の移動元記録（moved）も消す。在庫台帳は触らない（発生も消化も消えるので残数は動かない・INV-06）。
//    手動追加・出欠記録付き・保留の下段・管理生徒 ID の無い振替は触らない（オーナー確定 I・監査 M-B）。
// 2. 丸ごと振替した日に足した生徒: Q35 が「置かなかった」テンプレの生徒のうち、その日が振替元（移動元記録がある）なら、振替先の同じ時限・
//    同じ机番号の空いた席へ振替として置く（丸ごと振替と同じ形・在庫中立）。置けなければ未消化（振替元が休日なら自動発生に任せ、
//    休日でなければ台帳に origin を 1 件積む＝INV-06 の唯一の例外・オーナー確定 H）。どちらも Q35-8 の希望回数 −1 は積まない。
//
// このファイルは純関数だけ。巨大コンポーネントの関数（prepareStudentForMove・buildMovedSourceStatusEntry）は引数で受ける（循環 import を避ける）。

import type { ClassroomSettings } from '../../types/appState'
import type { RegularLessonRow } from '../basic-data/regularLessonModel'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'
import { studentSubjectKey, type TemplateDiffTemplateCell } from './templateDiffApply'
import { resolveDayOfWeekFromDateKey, type TemplateDiffSlotFilter } from './templateDefinitionDiff'
import { buildMakeupStockKey, isClosedDate, originTokenDateKey, parseOriginSlotNumberFromLabel, type ManualMakeupOrigin } from './makeupStock'
import { buildTemplatePendingDeskKey, isTemplatePendingLowerEmpty, placeIntoPendingLower, type TemplatePendingDeskMap } from './templatePendingDesks'

type StudentPair = [StudentEntry | null, StudentEntry | null]
type StatusPair = [StudentStatusEntry | null, StudentStatusEntry | null]

function liveStudentsOf(desk: DeskCell): StudentEntry[] {
  const slots: Array<StudentEntry | null> = desk.lesson?.studentSlots ?? [null, null]
  return slots.filter((student): student is StudentEntry => student != null)
}

/**
 * そのコマに同じ生徒が居るか（INV-12・regression-reviewer 2026-10-26 L-1）: 上段の生きている生徒に加え、**保留の下段の生徒**も見る
 * （下段は配置ではないが、上段へ同じ生徒を置くと解決で 2 か所になる）。Q40-2 の 'duplicate' と Q40-9 の両方がこれを使う。
 */
function isStudentPresentInCell(cell: SlotCell, pendingDesks: TemplatePendingDeskMap, identity: string) {
  return cell.desks.some((desk) => liveStudentsOf(desk).some((student) => studentIdentity(student) === identity)
    || (pendingDesks[buildTemplatePendingDeskKey(cell.id, desk.id)]?.lower.lesson?.studentSlots ?? []).some((student) => student != null && studentIdentity(student) === identity))
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
  /** 振替が置かれていたコマの日付（確認の画面の「振替先 M/D」用・2026-10-21）。 */
  targetDateKey: string
  deskId: string
  seatIndex: number
  student: StudentEntry
  sourceDateKey: string
  /** 振替元の時限（ラベルから取れないときは null）。範囲の判定にだけ使う（根拠は日単位で見る・Q40-1）。 */
  sourceSlotNumber: number | null
  /** 決定記録 48（2026-10-25）: 保留の下段に居る振替（Q40-2 の満席で下段へ置いたもの）。下段から外す。 */
  inLower?: boolean
}

export type MakeupOriginLedger = Record<string, ManualMakeupOrigin[]>

/** Q40-2 が台帳へ積む未消化 origin の印（理由ラベル）。外した生徒の分を保存が取り下げる（M-2）ときの判別に使う。 */
export const TEMPLATE_TRANSFER_STOCK_REASON = 'テンプレ保存（丸ごと振替で置けなかった分）'

export type TemplateTransferLedgerRemoval = {
  stockKey: string
  dateKey: string
  /** 積んだときの時限（Q40-2 は必ず時限つきで積む）。理由ラベルと合わせて同じ形の 1 件だけを外す。 */
  slotNumber: number
}

// Q40-2-4: テンプレ保存が積む未消化 origin（丸ごと振替で置けなかった分）。理由ラベルを付けて積む（取り下げ M-2 の判別用・在庫パネルの理由表示にも出る）。
// 時限は丸ごと振替の振替元のコマが分かっているので必ず付ける（removeTemplateTransferMakeupOrigin が同じ形で外す）。
export function appendTemplateTransferMakeupOrigin(originMap: MakeupOriginLedger, key: string, originDate: string, slotNumber: number): MakeupOriginLedger {
  const nextOrigin: ManualMakeupOrigin = { dateKey: originDate, slotNumber, reasonLabel: TEMPLATE_TRANSFER_STOCK_REASON }
  return {
    ...originMap,
    [key]: [...(originMap[key] ?? []), nextOrigin].sort((left, right) => left.dateKey.localeCompare(right.dateKey)),
  }
}

// Q40-2 M-2: テンプレ保存が積んだ印つき origin を 1 件だけ取り下げる。**理由ラベルまで同じ origin だけ**を外す（日付×時限が同じ手積みの origin が先頭に居ても
// それを外さない＝何も変えない保存〔全コマ〕を重ねても手積みの分が減らない）。無ければ台帳は参照ごとそのまま。
export function removeTemplateTransferMakeupOrigin(originMap: MakeupOriginLedger, key: string, originDate: string, slotNumber: number): MakeupOriginLedger {
  const currentDates = originMap[key] ?? []
  const targetIndex = currentDates.findIndex((entry) => entry.dateKey === originDate && entry.slotNumber === slotNumber && entry.reasonLabel === TEMPLATE_TRANSFER_STOCK_REASON)
  if (targetIndex < 0) return originMap
  const nextDates = currentDates.filter((_, index) => index !== targetIndex)
  if (nextDates.length === 0) {
    const { [key]: _removed, ...rest } = originMap
    return rest
  }
  return { ...originMap, [key]: nextDates }
}

/**
 * 振替元の**日**が「テンプレで変えたコマ」の範囲に入るか（その曜日のどれかの時限が範囲なら入る・日単位）。
 * 2026-10-21 改定（テスト教室 tp-51）: 以前は振替元の時限が分かるときだけ曜日×時限で判定していたが、根拠 (a)(b) は日単位なので範囲も日単位に揃える。
 * 時限で絞ると「時限を変える → 科目を変える」の 2 回目の保存（変えたコマ＝新しい時限だけ）で、旧時限を振替元に持つ旧科目の振替が範囲の外に
 * なり、根拠が無いのに消えず、後日の無関係な保存（同じ曜日の旧時限を触る保存）で初めて消えていた（確認文にも「消します」が出ない）。
 */
function isSourceInScope(sourceDateKey: string, _sourceSlotNumber: number | null, filter: TemplateDiffSlotFilter | null | undefined) {
  if (!filter) return true
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
 * 根拠を失った振替を集める（Q40-1）。対象は上段の生きている振替で、管理生徒 ID を持つものだけ（保留の下段・出欠記録・手動追加・名前だけの振替は見ない）。
 * 根拠は**日単位・生徒×科目**で見る（在庫の消化が同じ日付へフォールバックする `consumeOriginDates` と揃える。時限だけ変えたテンプレで振替を消さない＝監査 H-1/H-3）:
 *   (a) 新テンプレがその日（同じ曜日）にその生徒×科目の通常授業を持つ（管理セルの raw か、テンプレ行〔休日のコマは管理セルが空になるので行でも見る〕）
 *   (b) 在庫の正本がその生徒×科目の**その日の有効な origin** を持つ（台帳の origin〔通常授業の休みはここに積まれる〕・振替の休みの記録から立つ origin〔振替元の日〕・
 *       テンプレ行×休日の自動発生・保留の下段の記録。`collectMakeupOriginDatesByKey` を取り下げ後の台帳と保存後の盤面で呼ぶ＝判定を在庫と分けない・監査 H-2/H-A）
 */
export function collectOrphanedMakeups(params: {
  weeks: SlotCell[][]
  /** 新テンプレの管理セル（抑止前の raw を見る）。休日のコマは空になるので、根拠 (a) はテンプレ行（regularLessons）でも見る。 */
  templateCells: readonly TemplateDiffTemplateCell[]
  /** 新テンプレの通常授業の行（曜日×時限×生徒 ID×表示科目）。休日設定した日でも「テンプレがその生徒を持つ」を判定するための正本。 */
  regularLessons: readonly RegularLessonRow[]
  /** 保存前の在庫台帳（M-2 の取り下げ対象を探す）。 */
  manualMakeupAdjustments: MakeupOriginLedger
  /** 取り下げ後の台帳を渡すと、生徒×科目（`${管理生徒 ID}__${科目}`）ごとの有効な origin トークンを返す（呼び出し側が在庫の正本 collectMakeupOriginDatesByKey を配線する）。 */
  resolveLedgerOriginDates: (ledgerAfterRemovals: MakeupOriginLedger) => Record<string, string[]>
  effectiveStartDate: string
  slotFilter?: TemplateDiffSlotFilter | null
  /** 決定記録 48（2026-10-25）: 保留の下段の振替も走査する（Q40-2 の満席で下段へ置いた振替が足す→外すで孤児として残らないように・regression-reviewer M-2）。 */
  pendingDesks?: TemplatePendingDeskMap | null
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

  // M-2: Q40-2 が積んだ未消化 origin は、その生徒×科目がその曜日のテンプレから外れたら取り下げる（足す→外す、で台帳が元に戻る）。
  // 根拠 (b) は**取り下げ後の台帳**で引く（取り下げる origin を根拠に数えると、根拠の無い振替が次の保存まで残る＝監査 M-A）。
  const ledgerRemovals: TemplateTransferLedgerRemoval[] = []
  let ledgerAfterRemovals = params.manualMakeupAdjustments
  for (const [stockKey, origins] of Object.entries(params.manualMakeupAdjustments)) {
    const separator = stockKey.lastIndexOf('__')
    if (separator < 0) continue
    const studentId = stockKey.slice(0, separator)
    const subject = stockKey.slice(separator + 2)
    for (const origin of origins) {
      if (origin.reasonLabel !== TEMPLATE_TRANSFER_STOCK_REASON || origin.slotNumber == null || origin.dateKey < params.effectiveStartDate) continue
      if (!isSourceInScope(origin.dateKey, origin.slotNumber, params.slotFilter)) continue
      if (rowKeysByDay.get(resolveDayOfWeekFromDateKey(origin.dateKey))?.has(`${studentId}__${subject}`)) continue
      ledgerRemovals.push({ stockKey, dateKey: origin.dateKey, slotNumber: origin.slotNumber })
      ledgerAfterRemovals = removeTemplateTransferMakeupOrigin(ledgerAfterRemovals, stockKey, origin.dateKey, origin.slotNumber)
    }
  }
  const originDatesByKey = params.resolveLedgerOriginDates(ledgerAfterRemovals)

  const templateHas = (student: StudentEntry, dateKey: string) => {
    if (templateByDate.get(dateKey)?.has(studentSubjectKey(student))) return true
    return Boolean(rowKeysByDay.get(resolveDayOfWeekFromDateKey(dateKey))?.has(`${student.managedStudentId}__${student.subject}`))
  }
  const ledgerHas = (student: StudentEntry, dateKey: string) => (originDatesByKey[buildMakeupStockKey(student.managedStudentId ?? student.name, student.subject)] ?? []).some((token) => originTokenDateKey(token) === dateKey)
  const hasBasis = (student: StudentEntry, dateKey: string) => templateHas(student, dateKey) || ledgerHas(student, dateKey)

  const removals: OrphanedMakeupRemoval[] = []
  const scan = (cell: SlotCell, deskId: string, slots: readonly (StudentEntry | null)[] | undefined, inLower: boolean) => {
    slots?.forEach((student, seatIndex) => {
      if (!student || student.lessonType !== 'makeup' || student.manualAdded || !student.makeupSourceDate) return
      // 管理生徒 ID の無い振替（名前だけ・旧データ）はテンプレの生徒と突き合わせられないので触らない（消さない側に倒す・監査 M-B）。
      if (!student.managedStudentId) return
      const sourceDateKey = student.makeupSourceDate
      if (sourceDateKey < params.effectiveStartDate) return
      const sourceSlotNumber = parseOriginSlotNumberFromLabel(student.makeupSourceLabel) ?? null
      if (!isSourceInScope(sourceDateKey, sourceSlotNumber, params.slotFilter)) return
      if (hasBasis(student, sourceDateKey)) return
      removals.push({ cellId: cell.id, targetDateKey: cell.dateKey, deskId, seatIndex, student, sourceDateKey, sourceSlotNumber, ...(inLower ? { inLower: true } : {}) })
    })
  }
  for (const week of params.weeks) for (const cell of week) {
    if (cell.dateKey < params.effectiveStartDate) continue
    for (const desk of cell.desks) {
      scan(cell, desk.id, desk.lesson?.studentSlots, false)
      // 決定記録 48: 下段の振替（Q40-2 の満席で置いたもの・テンプレ保存の保留の下段の振替）も同じ根拠で見る。
      const lower = params.pendingDesks?.[buildTemplatePendingDeskKey(cell.id, desk.id)]?.lower
      if (lower?.lesson) scan(cell, desk.id, lower.lesson.studentSlots, true)
    }
  }
  return { removals, ledgerRemovals }
}

/** 根拠を失った振替を机から外し、振替元の移動元記録（moved・その日のその生徒×科目）も消す。触ったセルの ID を返す（保存直後の再マージの重ね合わせに渡す）。 */
export function removeOrphanedMakeups(weeks: SlotCell[][], removals: readonly OrphanedMakeupRemoval[], pendingDesks: TemplatePendingDeskMap = {}): { weeks: SlotCell[][]; removedMovedRecords: number; touchedCellIds: Set<string>; nextPendingDesks: TemplatePendingDeskMap } {
  if (removals.length === 0) return { weeks, removedMovedRecords: 0, touchedCellIds: new Set(), nextPendingDesks: pendingDesks }
  const byDesk = new Map<string, OrphanedMakeupRemoval[]>()
  for (const removal of removals) {
    if (removal.inLower) continue
    const key = `${removal.cellId}__${removal.deskId}`
    byDesk.set(key, [...(byDesk.get(key) ?? []), removal])
  }
  // 決定記録 48: 下段の振替は保留マップから外す。下段が空になれば保留のキーごと消す（上段はそのまま＝合流の計算は要らない）。
  let nextPendingDesks = pendingDesks
  for (const removal of removals) {
    if (!removal.inLower) continue
    const key = buildTemplatePendingDeskKey(removal.cellId, removal.deskId)
    const entry = nextPendingDesks[key]
    if (!entry?.lower.lesson) continue
    const slots = [...entry.lower.lesson.studentSlots] as StudentPair
    slots[removal.seatIndex] = null
    const lower = { ...entry.lower, lesson: { ...entry.lower.lesson, studentSlots: slots } }
    if (!slots.some(Boolean)) delete (lower as { lesson?: unknown }).lesson
    nextPendingDesks = { ...nextPendingDesks }
    if (isTemplatePendingLowerEmpty(lower)) delete nextPendingDesks[key]
    else nextPendingDesks[key] = { ...entry, lower }
  }
  // 振替元の移動元記録: 日 × 生徒×科目（根拠と同じく日単位。時限だけ変えた写しを残さない）
  const movedTargets = new Map<string, Set<string>>()
  for (const removal of removals) {
    movedTargets.set(removal.sourceDateKey, (movedTargets.get(removal.sourceDateKey) ?? new Set<string>()).add(studentSubjectKey(removal.student)))
  }
  const touchedCellIds = new Set<string>()
  let removedMovedRecords = 0
  // 変化の無い週は配列ごと同じ参照で返す（反映日より前だけの週は参照ごと不変＝INV-10・監査 L-A）。
  const nextWeeks = weeks.map((week) => {
    const nextWeek = week.map((cell) => {
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
    })
    return nextWeek.some((cell, index) => cell !== week[index]) ? nextWeek : week
  })
  return { weeks: nextWeeks, removedMovedRecords, touchedCellIds, nextPendingDesks }
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
  /** 同じ机番号の机に置けず、同じコマの別の机（保留でなく空席。講師の有無は問わない）へ置いた（Q40-2 改定・オーナー確定 2026-10-21 L-5 (a)）。 */
  fallbackDesk: boolean
  /** 置いた机に講師が居ない（講師が付くまで講師日程表には出ない。確認の画面の理由に出す・オーナー指示 2026-10-21）。 */
  teacherless: boolean
}

export type WholeDayTransferStocked = {
  student: StudentEntry
  sourceDateKey: string
  sourceSlotNumber: number
  /** true ＝ 台帳に origin を 1 件積む（振替元が休日でない）。false ＝ 休日・定休日なので自動の不足 origin に任せる。 */
  ledger: boolean
  /**
   * no-seat ＝ 振替先のコマが満席（どの机にも空席が無い。保留の机は数えない）。duplicate ＝ 同じコマに同じ生徒が生きている。no-target-cell ＝ 振替先のコマが無い。
   * （2026-10-21 オーナー指示: 講師のいない机にも置き、未消化にするのは満席のときだけ。no-teacher / pending-desk は使わなくなった＝互換のため型に残す）
   */
  reason: 'no-seat' | 'no-teacher' | 'pending-desk' | 'duplicate' | 'no-target-cell'
}

/** 精算済みとして触らなかった生徒（確認の画面に理由を出すため・2026-10-21）。 */
export type WholeDayTransferSettled = { student: StudentEntry; sourceDateKey: string; sourceSlotNumber: number }

/**
 * 決定記録 48（2026-10-25・(b)-1）: 振替先のコマが満席で、同じ机番号の机の**下段（保留・緑）**へ振替として置いた生徒。
 * 旧「満席なら未消化（台帳に origin 1 件＝INV-06 の唯一の例外）」を置き換える。在庫中立（下段の振替も消化に数える＝INV-06 の 3 本目の走査）。
 * 上段の席が空けば Q28 で自動で 1 行に戻る。既知の限界 L-5（台帳に積んでも残数が増えない消失）はこれで閉じる。
 */
export type WholeDayTransferPendingPlacement = {
  student: StudentEntry
  sourceDateKey: string
  sourceSlotNumber: number
  targetDateKey: string
  targetCellId: string
  /** 下段を持つ机（同じ机番号。埋まっていれば次の机）。 */
  deskId: string
  deskIndex: number
  /** 下段の席。 */
  seatIndex: number
  /** 同じ机番号の下段が埋まっていて次の机の下段へ置いた。 */
  fallbackDesk: boolean
}

export type WholeDayTransferFollowPlan = {
  weeks: SlotCell[][]
  placed: WholeDayTransferPlacement[]
  stocked: WholeDayTransferStocked[]
  settled: WholeDayTransferSettled[]
  /** 決定記録 48: 満席のため同じ机番号の下段（保留）へ置いた生徒。 */
  pendingPlaced: WholeDayTransferPendingPlacement[]
  /** 下段へ置いた結果の保留マップ（変化が無ければ入力と同じ参照）。入口が nextPendingDesks へ合流させる。 */
  nextPendingDesks: TemplatePendingDeskMap
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
   * 精算済みの生徒（権威関数 resolveWholeDayTransferSettlement が決めた集合。skipped と同じ要素参照）。触らない（置かず・未消化にせず・−1 もしない＝Q35-8 と同じ判定・2026-10-21）。
   * 省略不可（省略できると全員を置こうとして再保存で二重になる）。
   */
  settled: ReadonlySet<WholeDayTransferSkippedStudent>
  prepareStudentForMove: (student: StudentEntry, sourceDateKey: string, sourceSlotNumber: number, targetDateKey: string) => StudentEntry
  buildMovedSourceStatusEntry: (params: { student: StudentEntry; sourceCell: SlotCell; sourceDesk: DeskCell; destinationDateKey: string; destinationSlotNumber: number }) => StudentStatusEntry
  /** 下段を作る日時（ISO・保存の createdAt）。省略時は現在時刻。 */
  createdAt?: string
}): WholeDayTransferFollowPlan {
  const placed: WholeDayTransferPlacement[] = []
  const stocked: WholeDayTransferStocked[] = []
  const pendingPlaced: WholeDayTransferPendingPlacement[] = []
  let nextPendingDesks = params.pendingDesks
  const handledKeys = new Set<string>()
  let handledCount = 0
  const touchedCellIds = new Set<string>()
  if (params.skipped.length === 0) return { weeks: params.weeks, placed, stocked, settled: [], pendingPlaced, nextPendingDesks, handledKeys, handledCount, touchedCellIds }

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

  const settled: WholeDayTransferSettled[] = []
  for (const item of params.skipped) {
    if (params.settled.has(item)) {
      settled.push({ student: item.student, sourceDateKey: item.dateKey, sourceSlotNumber: item.slotNumber })
      continue
    }
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
    const identity = studentIdentity(item.student)
    if (isStudentPresentInCell(targetCell, nextPendingDesks, identity)) { stock(item, 'duplicate'); continue }
    // 置ける机か（保留でない・空席がある。講師の有無は問わない＝オーナー指示 2026-10-21「講師のいない席でも割り振り、満席のときだけ未消化へ」。
    // 講師が居ない机に置いた授業は、室長が手で講師なしの机に置いた授業と同じ扱い＝講師が付くまで講師日程表に出ない）。
    const freeSeatOf = (desk: DeskCell) => (isSeatFree(desk, item.seatIndex) ? item.seatIndex : (isSeatFree(desk, item.seatIndex === 0 ? 1 : 0) ? (item.seatIndex === 0 ? 1 : 0) : -1))
    const judge = (desk: DeskCell | undefined): { seatIndex: number } | 'no-seat' => {
      if (!desk) return 'no-seat'
      if (params.pendingDesks[buildTemplatePendingDeskKey(targetCell.id, desk.id)]) return 'no-seat'
      const seatIndex = freeSeatOf(desk)
      return seatIndex < 0 ? 'no-seat' : { seatIndex }
    }
    // 優先順: 同じ机番号の机（丸ごと振替の 1 対 1 の写像）→ 同じコマの別の机で講師が居る机（机番号の順）→ 講師の居ない机（机番号の順）。
    // どの机にも空席が無い（満席）ときだけ未消化（オーナー確定 2026-10-21・既知の限界 L-5）。
    const sameDesk = targetCell.desks[item.deskIndex]
    const sameDeskJudge = judge(sameDesk)
    let targetDesk: DeskCell | undefined
    let seatIndex = -1
    let fallbackDesk = false
    if (typeof sameDeskJudge !== 'string') { targetDesk = sameDesk; seatIndex = sameDeskJudge.seatIndex }
    else {
      const candidates = [...targetCell.desks.filter((desk) => desk !== sameDesk && desk.teacher.trim()), ...targetCell.desks.filter((desk) => desk !== sameDesk && !desk.teacher.trim())]
      for (const desk of candidates) {
        const verdict = judge(desk)
        if (typeof verdict === 'string') continue
        targetDesk = desk; seatIndex = verdict.seatIndex; fallbackDesk = true
        break
      }
    }
    const moved = params.prepareStudentForMove({ ...item.student, id: `transfer_${item.dateKey}_${item.slotNumber}_${item.deskIndex}_${item.seatIndex}` }, item.dateKey, item.slotNumber, destination.dateKey)
    if (!targetDesk || seatIndex < 0) {
      // 決定記録 48（2026-10-25・(b)-1）: 満席なら未消化へ逃がさず、同じ机番号の机の**下段（保留・緑）**へ振替として置く（埋まっていれば次の机の下段）。
      // 下段の振替は在庫の消化に数える（INV-06 の 3 本目の走査）ので台帳には積まない＝在庫中立。L-5（台帳に積んでも残数が増えない消失）はこれで閉じる。
      const lowerPlacement = placeIntoPendingLower({ cell: targetCell, pendingDesks: nextPendingDesks, preferredDeskIndex: item.deskIndex, preferredSeat: item.seatIndex, student: moved, effectiveStartDate: destination.dateKey, createdAt: params.createdAt ?? new Date().toISOString(), kind: 'transfer-follow-full', note: buildTransferFollowPendingNote(item.dateKey, destination.dateKey) })
      if (!lowerPlacement) { stock(item, 'no-seat'); continue }
      nextPendingDesks = lowerPlacement.nextPendingDesks
      pendingPlaced.push({ student: item.student, sourceDateKey: item.dateKey, sourceSlotNumber: item.slotNumber, targetDateKey: destination.dateKey, targetCellId: targetCell.id, deskId: lowerPlacement.deskId, deskIndex: lowerPlacement.deskIndex, seatIndex: lowerPlacement.seatIndex, fallbackDesk: lowerPlacement.deskIndex !== item.deskIndex })
    } else {
      const teacherless = !targetDesk.teacher.trim()
      const slots = [...(targetDesk.lesson?.studentSlots ?? [null, null])] as StudentPair
      slots[seatIndex] = moved
      const placedDesk = targetDesk
      const nextTargetDesk: DeskCell = { ...placedDesk, lesson: placedDesk.lesson ? { ...placedDesk.lesson, studentSlots: slots } : { id: `daymove_${item.dateKey}_${item.slotNumber}_${item.deskIndex}`, studentSlots: slots } }
      replaceCell({ ...targetCell, desks: targetCell.desks.map((desk) => (desk === placedDesk ? nextTargetDesk : desk)) })
      placed.push({ student: item.student, sourceDateKey: item.dateKey, sourceSlotNumber: item.slotNumber, targetDateKey: destination.dateKey, targetCellId: targetCell.id, deskId: placedDesk.id, seatIndex, fallbackDesk, teacherless })
    }
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

  if (touchedCellIds.size === 0) return { weeks: params.weeks, placed, stocked, settled, pendingPlaced, nextPendingDesks, handledKeys, handledCount, touchedCellIds }
  const weeks = params.weeks.map((week) => {
    const next = week.map((cell) => cellById.get(cell.id) ?? cell)
    return next.some((cell, index) => cell !== week[index]) ? next : week
  })
  return { weeks, placed, stocked, settled, pendingPlaced, nextPendingDesks, handledKeys, handledCount, touchedCellIds }
}

/** 下段の理由文（Q40-2 の満席・決定記録 48）。 */
export function buildTransferFollowPendingNote(sourceDateKey: string, targetDateKey: string) {
  return `テンプレ保存で丸ごと振替した日（${sourceDateKey}）に足した生徒の振替先（${targetDateKey}）が満席だったため、保留（下段）に振替として置きました。室長が動かすか採用で片づけてください。`
}


/** 保存直後の再マージの重ね合わせを、追従で触ったセルにも当てるための絞り込み。絞り込みが無い（全コマ）ならそのまま。 */
export function extendTemplateDiffSlotFilterWithCells(filter: TemplateDiffSlotFilter | null | undefined, cellIds: ReadonlySet<string>): TemplateDiffSlotFilter | null | undefined {
  if (!filter || cellIds.size === 0) return filter
  return { ...filter, cellIds: new Set([...(filter.cellIds ?? []), ...cellIds]) }
}

// ============================================================================
// 決定記録 46（オーナー決定 2026-10-25・spec-template-behavior §H Q40-9）: テンプレで時限を変えたら、丸ごと振替で移送済みの振替も新しい時限へ動かす。
//
// ★対象は「同じ授業」とみなせるものだけ＝丸ごと振替の 1 対 1 の写像が残っている組（振替元 D の旧時限に移動元記録〔moved・振替先 T・旧時限〕があり、
//   振替先 T の旧時限の上段にその生徒×科目の振替〔もと＝D の旧時限〕が生きている）。生徒×科目×振替元の日付×時限が一致するもの。
// ★きっかけは Q40-3 の「精算済み」（新しい時限の分は移送済みの振替が説明している＝置かない）。精算済みの生徒について、旧テンプレ→新テンプレで
//   その曜日の時限が 1 つだけ入れ替わった（旧時限が 1 つ消え、新しい時限が 1 つ増えた）ときだけ動かす。曖昧な形（2 つ以上の増減）は動かさない＝今までどおり。
// ★動かさない（決定 46 の例外）: 振替先が反映日より前／振替に出欠記録あり（上段に生きていない）／室長が手で動かした後（T の旧時限に居ない）／
//   保留の机の上段・下段／新しい時限に同じ生徒が既に居る（INV-12）／振替先のコマが無い。
// ★置き方: 新しい時限のテンプレの机番号（Q35 が置かなかった生徒の机・席）→ 同じコマの別の机（講師あり → なし・机番号順）→ 満席なら同じ机番号の
//   下段（保留・緑・決定記録 48・placeIntoPendingLower）。振替の「もと」ラベルの時限を新しい時限に、移動元記録を D の新しい時限の机へ移す。
// ★会計: 在庫中立（振替を別のコマへ移すだけ・移動元記録は会計を持たない）。台帳・抑止キー・希望回数は触らない（新しい時限の抑止キーは Q35 が既に積む。
//   旧時限の抑止キーはテンプレがその時限に生徒を持たなくなるので効かない）。
// ============================================================================

export type SlotChangeFollowMove = {
  student: StudentEntry
  sourceDateKey: string
  oldSlotNumber: number
  newSlotNumber: number
  targetDateKey: string
  targetCellId: string
  deskId: string
  deskIndex: number
  seatIndex: number
  placement: 'upper' | 'pending'
  /** テンプレの机番号が使えず別の机へ置いた／下段が次の机。 */
  fallbackDesk: boolean
  /** 上段に置いた机に講師が居ない。 */
  teacherless: boolean
}

export type SlotChangeFollowPlan = {
  weeks: SlotCell[][]
  nextPendingDesks: TemplatePendingDeskMap
  moves: SlotChangeFollowMove[]
  touchedCellIds: Set<string>
}

/** 旧テンプレ→新テンプレで、曜日 dow の生徒×科目の時限が 1 つだけ入れ替わったなら旧時限を返す（newSlot が増えた側でなければ null）。 */
export function resolveTemplateSlotChange(previousRows: readonly RegularLessonRow[], nextRows: readonly RegularLessonRow[], dow: number, studentId: string, subject: string, newSlot: number, schoolYear?: number): number | null {
  const slotsOf = (rows: readonly RegularLessonRow[]) => {
    const slots = new Set<number>()
    for (const row of rows) {
      if (row.dayOfWeek !== dow) continue
      // 年度で絞る（保存前の行には複数の年度が入りうる・regression-reviewer 2026-10-26 L-3。diffRegularLessonRowsBySlot と同じ）。
      if (schoolYear != null && row.schoolYear !== schoolYear) continue
      if ((row.student1Id === studentId && row.subject1 === subject) || (row.student2Id === studentId && row.subject2 === subject)) slots.add(row.slotNumber)
    }
    return slots
  }
  const before = slotsOf(previousRows)
  const after = slotsOf(nextRows)
  const removed = [...before].filter((slot) => !after.has(slot))
  const added = [...after].filter((slot) => !before.has(slot))
  if (removed.length !== 1 || added.length !== 1 || added[0] !== newSlot) return null
  return removed[0]
}

/** 曜日 dow で、旧テンプレ → 新テンプレの時限が 1 つだけ入れ替わった生徒×科目の一覧（入れ替わりが曖昧な生徒×科目は入れない）。 */
export function listTemplateSlotChanges(previousRows: readonly RegularLessonRow[], nextRows: readonly RegularLessonRow[], dow: number, schoolYear?: number): Array<{ studentId: string; subject: string; oldSlot: number; newSlot: number }> {
  const keysOf = (rows: readonly RegularLessonRow[]) => {
    const keys = new Map<string, { studentId: string; subject: string }>()
    for (const row of rows) {
      if (row.dayOfWeek !== dow || (schoolYear != null && row.schoolYear !== schoolYear)) continue
      for (const [studentId, subject] of [[row.student1Id, row.subject1], [row.student2Id, row.subject2]] as const) {
        if (studentId && subject) keys.set(`${studentId}__${subject}`, { studentId, subject })
      }
    }
    return keys
  }
  const all = new Map([...keysOf(previousRows), ...keysOf(nextRows)])
  const changes: Array<{ studentId: string; subject: string; oldSlot: number; newSlot: number }> = []
  for (const { studentId, subject } of all.values()) {
    const newSlots = [...new Set(nextRows.filter((row) => row.dayOfWeek === dow && (schoolYear == null || row.schoolYear === schoolYear) && ((row.student1Id === studentId && row.subject1 === subject) || (row.student2Id === studentId && row.subject2 === subject))).map((row) => row.slotNumber))]
    for (const newSlot of newSlots) {
      const oldSlot = resolveTemplateSlotChange(previousRows, nextRows, dow, studentId, subject, newSlot, schoolYear)
      if (oldSlot != null) changes.push({ studentId, subject, oldSlot, newSlot })
    }
  }
  return changes
}

export function planSlotChangeTransferFollow(params: {
  weeks: SlotCell[][]
  pendingDesks: TemplatePendingDeskMap
  /** 保存前のテンプレの行。無ければ何もしない（呼び出し側は必ず渡す＝配線テストで固定）。 */
  previousRegularLessons: readonly RegularLessonRow[] | null | undefined
  regularLessons: readonly RegularLessonRow[]
  /**
   * 新しい時限のテンプレの机・席の手がかり（Q35 が置かなかった生徒＝精算済みを含む・机・席つき）。無ければテンプレの管理セル（抑止前の raw ／休日は
   * closedTransferSourceDesks）から引き、それも無ければ振替の今の机番号・席を使う（丸ごと振替の 1 対 1 の机番号）。
   */
  settled: readonly WholeDayTransferSkippedStudent[]
  /** テンプレの管理セル（差分反映が作ったもの）。机・席の手がかり。 */
  templateCells?: readonly TemplateDiffTemplateCell[]
  effectiveStartDate: string
  createdAt: string
  formatOriginLabel: (dateKey: string, slotNumber: number) => string
  buildMovedSourceStatusEntry: (params: { student: StudentEntry; sourceCell: SlotCell; sourceDesk: DeskCell; destinationDateKey: string; destinationSlotNumber: number }) => StudentStatusEntry
  /**
   * 丸ごと振替の振替先の日（日単位の足場講師の抑止がある日＝丸ごと振替が両日に積む印）。振替先 T がこれに入らなければ動かさない
   * （regression-reviewer 2026-10-26 M-1: 1 コマの別日 D&D の振替と移動元記録は「行き先の時限＝旧時限」を満たしうるので、時限だけでは丸ごと振替と区別できない＝INV-02）。
   */
  wholeDayTransferDates: ReadonlySet<string>
  /** 年度の解決（日付 → 年度）。省略時は年度で絞らない。 */
  resolveSchoolYear?: (dateKey: string) => number
}): SlotChangeFollowPlan {
  const moves: SlotChangeFollowMove[] = []
  const touchedCellIds = new Set<string>()
  let nextPendingDesks = params.pendingDesks
  if (!params.previousRegularLessons) return { weeks: params.weeks, nextPendingDesks, moves, touchedCellIds }

  const cellById = new Map<string, SlotCell>()
  for (const week of params.weeks) for (const cell of week) cellById.set(cell.id, cell)
  const cellByDateSlot = new Map<string, string>()
  for (const cell of cellById.values()) cellByDateSlot.set(dateSlotKey(cell.dateKey, cell.slotNumber), cell.id)
  const cellAt = (dateKey: string, slotNumber: number) => {
    const id = cellByDateSlot.get(dateSlotKey(dateKey, slotNumber))
    return id ? cellById.get(id) : undefined
  }
  const replaceDesk = (cell: SlotCell, deskIndex: number, desk: DeskCell) => {
    const next = { ...cell, desks: cell.desks.map((entry, index) => (index === deskIndex ? desk : entry)) }
    cellById.set(cell.id, next)
    touchedCellIds.add(cell.id)
    return next
  }
  const isPendingDesk = (cell: SlotCell, desk: DeskCell) => Boolean(nextPendingDesks[buildTemplatePendingDeskKey(cell.id, desk.id)])
  const freeSeatOf = (desk: DeskCell, preferred: number) => (isSeatFree(desk, preferred) ? preferred : (isSeatFree(desk, preferred === 0 ? 1 : 0) ? (preferred === 0 ? 1 : 0) : -1))

  // きっかけ（オーナー決定 2026-10-26「往復でも戻す」・regression-reviewer M-2）: 精算済みに頼らず、丸ごと振替した日（反映日以降）ごとに
  // 「その曜日の時限の 1 対 1 の入れ替わり」を見る。精算済みだけを見ると、往復（5限 → 3限 → 5限）の 2 回目は旧時限の抑止キーが残っていて
  // Q35 の「置かなかった生徒」にならず、きっかけが立たなかった。
  const positionHint = (dateKey: string, slotNumber: number, studentId: string, subject: string): { deskIndex: number; seatIndex: number } | null => {
    const fromSettled = params.settled.find((entry) => entry.dateKey === dateKey && entry.slotNumber === slotNumber && entry.student.managedStudentId === studentId && entry.student.subject === subject)
    if (fromSettled) return { deskIndex: fromSettled.deskIndex, seatIndex: fromSettled.seatIndex }
    const templateCell = params.templateCells?.find((entry) => entry.raw.dateKey === dateKey && entry.raw.slotNumber === slotNumber)
    if (!templateCell) return null
    const desks = templateCell.raw.desks.some((desk) => liveStudentsOf(desk).length > 0) ? templateCell.raw.desks : (templateCell.closedTransferSourceDesks ?? [])
    for (let deskIndex = 0; deskIndex < desks.length; deskIndex += 1) {
      const seatIndex = (desks[deskIndex].lesson?.studentSlots ?? []).findIndex((student) => student?.managedStudentId === studentId && student.subject === subject)
      if (seatIndex >= 0) return { deskIndex, seatIndex }
    }
    return null
  }
  const sourceDates = [...new Set([...cellById.values()].map((cell) => cell.dateKey))]
    .filter((dateKey) => dateKey >= params.effectiveStartDate && params.wholeDayTransferDates.has(dateKey))
    .sort()
  const candidates: Array<{ sourceDateKey: string; studentId: string; subject: string; oldSlot: number; newSlot: number }> = []
  for (const sourceDateKey of sourceDates) {
    for (const change of listTemplateSlotChanges(params.previousRegularLessons, params.regularLessons, resolveDayOfWeekFromDateKey(sourceDateKey), params.resolveSchoolYear?.(sourceDateKey))) {
      candidates.push({ sourceDateKey, ...change })
    }
  }

  for (const candidate of candidates) {
    const { sourceDateKey, studentId, oldSlot, newSlot } = candidate
    const subjectKey = `${studentId}__${candidate.subject}`

    // 1. 振替元 D の旧時限の移動元記録（丸ごと振替の 1 対 1＝振替先の時限も旧時限）。
    const oldSourceCell = cellAt(sourceDateKey, oldSlot)
    if (!oldSourceCell) continue
    let recordDeskIndex = -1
    let recordSeat = -1
    oldSourceCell.desks.forEach((desk, deskIndex) => desk.statusSlots?.forEach((entry, seat) => {
      if (recordDeskIndex >= 0 || !entry || entry.status !== 'moved' || !entry.moveDestinationDateKey) return
      if (studentSubjectKey(entry) !== subjectKey) return
      if ((entry.moveDestinationSlotNumber ?? oldSlot) !== oldSlot) return
      recordDeskIndex = deskIndex
      recordSeat = seat
    }))
    if (recordDeskIndex < 0) continue
    const targetDateKey = oldSourceCell.desks[recordDeskIndex].statusSlots![recordSeat]!.moveDestinationDateKey!
    if (targetDateKey < params.effectiveStartDate) continue
    // M-1: 振替先が丸ごと振替の日でなければ（1 コマの別日 D&D など室長が置き先を選んだ授業）動かさない。
    if (!params.wholeDayTransferDates.has(targetDateKey) || !params.wholeDayTransferDates.has(sourceDateKey)) continue

    // 2. 振替先 T の旧時限の上段に生きている振替（もと＝D の旧時限）。保留の机は動かさない。
    const oldTargetCell = cellAt(targetDateKey, oldSlot)
    const newTargetCell = cellAt(targetDateKey, newSlot)
    if (!oldTargetCell || !newTargetCell) continue
    let makeupDeskIndex = -1
    let makeupSeat = -1
    oldTargetCell.desks.forEach((desk, deskIndex) => desk.lesson?.studentSlots.forEach((student, seat) => {
      if (makeupDeskIndex >= 0 || !student || student.lessonType !== 'makeup' || student.manualAdded) return
      if (studentSubjectKey(student) !== subjectKey || student.makeupSourceDate !== sourceDateKey) return
      if (parseOriginSlotNumberFromLabel(student.makeupSourceLabel) !== oldSlot) return
      makeupDeskIndex = deskIndex
      makeupSeat = seat
    }))
    if (makeupDeskIndex < 0) continue
    if (isPendingDesk(oldTargetCell, oldTargetCell.desks[makeupDeskIndex])) continue
    // INV-12: 新しい時限に同じ生徒が既に居る（上段・保留の下段）なら動かさない。
    if (isStudentPresentInCell(newTargetCell, nextPendingDesks, studentId)) continue

    const makeup = oldTargetCell.desks[makeupDeskIndex].lesson!.studentSlots[makeupSeat]!
    const moved: StudentEntry = { ...makeup, makeupSourceLabel: params.formatOriginLabel(sourceDateKey, newSlot) }
    // 新しい時限のテンプレの机・席（無ければ振替の今の机番号・席＝丸ごと振替の 1 対 1 の机番号）。
    // 移動元記録と確認の画面の生徒は、旧時限の移動元記録が持つ元の授業（通常授業）の形で作る（振替の形で記録を作らない）。
    const oldRecord = oldSourceCell.desks[recordDeskIndex].statusSlots![recordSeat]!
    const recordStudent: StudentEntry = {
      id: oldRecord.studentId, name: oldRecord.name, managedStudentId: oldRecord.managedStudentId, grade: oldRecord.grade, birthDate: oldRecord.birthDate, noteSuffix: oldRecord.noteSuffix,
      subject: oldRecord.subject, lessonType: oldRecord.lessonType, teacherType: oldRecord.teacherType, ...(oldRecord.manualAdded ? { manualAdded: true } : {}),
    }
    const item = { ...(positionHint(sourceDateKey, newSlot, studentId, candidate.subject) ?? { deskIndex: makeupDeskIndex, seatIndex: makeupSeat }), student: recordStudent }

    // 3. 置き先（新しい時限のテンプレの机 → 別の机〔講師あり → なし〕 → 下段）。置き先が決まってから旧時限から外す（置けないのに外さない）。
    let placedDeskIndex = -1
    let placedSeat = -1
    const preferredDesk = newTargetCell.desks[item.deskIndex]
    if (preferredDesk && !isPendingDesk(newTargetCell, preferredDesk)) {
      const seat = freeSeatOf(preferredDesk, item.seatIndex)
      if (seat >= 0) { placedDeskIndex = item.deskIndex; placedSeat = seat }
    }
    if (placedDeskIndex < 0) {
      const indexed = newTargetCell.desks.map((desk, index) => ({ desk, index })).filter(({ index }) => index !== item.deskIndex)
      for (const { desk, index } of [...indexed.filter(({ desk }) => desk.teacher.trim()), ...indexed.filter(({ desk }) => !desk.teacher.trim())]) {
        if (isPendingDesk(newTargetCell, desk)) continue
        const seat = freeSeatOf(desk, item.seatIndex)
        if (seat < 0) continue
        placedDeskIndex = index
        placedSeat = seat
        break
      }
    }
    let lowerPlacement: ReturnType<typeof placeIntoPendingLower> = null
    if (placedDeskIndex < 0) {
      lowerPlacement = placeIntoPendingLower({
        cell: newTargetCell, pendingDesks: nextPendingDesks, preferredDeskIndex: item.deskIndex, preferredSeat: item.seatIndex, student: moved,
        effectiveStartDate: targetDateKey, createdAt: params.createdAt, kind: 'slot-follow-full',
        note: `テンプレで時限を変えた（${oldSlot}限 → ${newSlot}限）ので丸ごと振替の振替を新しい時限へ移しましたが、満席だったため保留（下段）に置きました。室長が動かすか採用で片づけてください。`,
      })
      if (!lowerPlacement) continue
    }

    // 4. 旧時限から外す。
    const oldDesk = oldTargetCell.desks[makeupDeskIndex]
    const oldSlots = [...oldDesk.lesson!.studentSlots] as StudentPair
    oldSlots[makeupSeat] = null
    const nextOldDesk: DeskCell = { ...oldDesk }
    if (oldSlots.some(Boolean)) nextOldDesk.lesson = { ...oldDesk.lesson!, studentSlots: oldSlots }
    else delete nextOldDesk.lesson
    replaceDesk(oldTargetCell, makeupDeskIndex, nextOldDesk)

    // 5. 新しい時限へ置く。
    const freshNewTargetCell = cellById.get(newTargetCell.id)!
    let teacherless = false
    if (lowerPlacement) {
      nextPendingDesks = lowerPlacement.nextPendingDesks
    } else {
      const desk = freshNewTargetCell.desks[placedDeskIndex]
      const slots = [...(desk.lesson?.studentSlots ?? [null, null])] as StudentPair
      slots[placedSeat] = moved
      teacherless = !desk.teacher.trim()
      replaceDesk(freshNewTargetCell, placedDeskIndex, { ...desk, lesson: desk.lesson ? { ...desk.lesson, studentSlots: slots } : { id: `daymove_${sourceDateKey}_${newSlot}_${placedDeskIndex}`, studentSlots: slots } })
    }

    // 6. 移動元記録を D の新しい時限の机（テンプレの机 → 同じコマの別の机の空いた席）へ移す。どこにも空きが無ければ旧時限の記録をそのまま残す
    //    （記録を消すと「休)」と次の追従の手がかりを失う・regression-reviewer 2026-10-26 L-4）。
    const sourceNew = cellAt(sourceDateKey, newSlot)
    let recordTarget: { deskIndex: number; seat: number } | null = null
    if (sourceNew) {
      const order = [item.deskIndex, ...sourceNew.desks.map((_, index) => index).filter((index) => index !== item.deskIndex)]
      for (const deskIndex of order) {
        const desk = sourceNew.desks[deskIndex]
        if (!desk) continue
        const seat = freeSeatOf(desk, item.seatIndex)
        if (seat >= 0) { recordTarget = { deskIndex, seat }; break }
      }
    }
    if (sourceNew && recordTarget) {
      const sourceOld = cellById.get(oldSourceCell.id)!
      const recordDesk = sourceOld.desks[recordDeskIndex]
      const recordSlots = [...recordDesk.statusSlots!] as StatusPair
      recordSlots[recordSeat] = null
      const nextRecordDesk: DeskCell = { ...recordDesk }
      if (recordSlots.some(Boolean)) nextRecordDesk.statusSlots = recordSlots
      else delete nextRecordDesk.statusSlots
      replaceDesk(sourceOld, recordDeskIndex, nextRecordDesk)
      const freshSourceNew = cellById.get(sourceNew.id)!
      const sourceNewDesk = freshSourceNew.desks[recordTarget.deskIndex]
      const entry = params.buildMovedSourceStatusEntry({ student: item.student, sourceCell: freshSourceNew, sourceDesk: sourceNewDesk, destinationDateKey: targetDateKey, destinationSlotNumber: newSlot })
      const statusSlots = [...(sourceNewDesk.statusSlots ?? [null, null])] as StatusPair
      statusSlots[recordTarget.seat] = entry
      replaceDesk(freshSourceNew, recordTarget.deskIndex, { ...sourceNewDesk, statusSlots })
    }

    moves.push({
      student: item.student, sourceDateKey, oldSlotNumber: oldSlot, newSlotNumber: newSlot, targetDateKey, targetCellId: newTargetCell.id,
      deskId: lowerPlacement ? lowerPlacement.deskId : freshNewTargetCell.desks[placedDeskIndex].id,
      deskIndex: lowerPlacement ? lowerPlacement.deskIndex : placedDeskIndex,
      seatIndex: lowerPlacement ? lowerPlacement.seatIndex : placedSeat,
      placement: lowerPlacement ? 'pending' : 'upper',
      fallbackDesk: (lowerPlacement ? lowerPlacement.deskIndex : placedDeskIndex) !== item.deskIndex,
      teacherless,
    })
  }

  if (touchedCellIds.size === 0) return { weeks: params.weeks, nextPendingDesks, moves, touchedCellIds }
  const weeks = params.weeks.map((week) => {
    const next = week.map((cell) => cellById.get(cell.id) ?? cell)
    return next.some((cell, index) => cell !== week[index]) ? next : week
  })
  return { weeks, nextPendingDesks, moves, touchedCellIds }
}
