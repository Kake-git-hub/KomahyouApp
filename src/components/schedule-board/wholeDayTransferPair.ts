// 丸ごと振替の付け替え（docs/spec-template-conflict-v2.md §3・§1-1 #17・§9 決定記録 2・3・12・段 4）の純関数。
//
// ★正本は「移動元の日 D → 移動先の日 D'」の**組 1 本**。個々の振替を正本にしない。
//   組がある間、再マージ（remergeBoardWeekWithManagedData）とテンプレの差分反映（computeTemplateDiffApplyForBoard）は、
//   どちらも共通の管理セルの準備（buildAppliedManagedPostFreezeCells）で次のように当てる（1 か所だけ・経路ごとに書き写さない）:
//     - D' には **D の曜日のテンプレ**を D' のテンプレとして展開する（時限・机番号そのまま・出自 template・`lessonType='makeup'`＋
//       `makeupSourceDate=D`＋`wholeDayPairSourceDate=D` で「振)」）。D' 自身の曜日のテンプレは展開しない（消去・在庫に入れない・決定記録 2）。
//     - D にはテンプレを展開しない。代わりに D のテンプレの生徒の席へ表示専用の「休)」記録（moved・`wholeDayPairDerived`）を毎回作り直す。
//   こうすると日程表・PDF・保護者 QR（盤面の写しを読む）・回数表は盤面を読むだけで揃い、テンプレを変えても D の新テンプレに追従する（4-3）。
//
// ★組の置き場: 専用の保存項目を足さず、`suppressedRegularLessonOccurrences` に相乗りする（`TEMPLATE_TEACHER__DAY__` と同じ作法）。
//   この配列は 保存/復元・weekly-parts・Undo/Redo・publish 3 経路・App のダーティ署名・overlay への受け渡しが**既に全経路で通っている**
//   （新しい項目は約 40 か所の配線が要り、1 つ漏れると組が黙って消える＝ScheduleBoardScreen の buildTemplateTeacherSuppressionKey の注記）。
//   第 2 版のテンプレ保存（差分反映）は抑止キーを日付で消さない（消すのは個別に特定したキーだけ）ので、テンプレを反映しても組は残る（4-2）。
//   休日設定も抑止キーを消さない。キーの形は `WHOLE_DAY_PAIR__<D>__<D'>__0`（4 分割・生徒キーとは形式上一致しない）。
//
// ★会計: 付け替えそのものは在庫中立（spec-makeup-stock §B-2-3 と同じ均衡＝D' の振替は D を振替元とし、
//   台帳に origin の無い振替は「消化 +1 と使用済み origin +1」が打ち消し合う・D が休日なら休日の自動発生を消化する）。
//   D' で休みにすると振替を休んだ記録（collectAbsentMakeupOrigins）で在庫 +1（通常の休みと同じ・4-5）。
// ★予定数は移動元 D の月で数える（4-8・決定記録 3）。読み手は isWholeDayPairExpandedStudent の印で D の日付に寄せる。

import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'
import { isManualOriginStudent } from './placementOrigin'
import { buildTemplatePendingDeskKey, type TemplatePendingDeskMap } from './templatePendingDesks'

const WHOLE_DAY_PAIR_PREFIX = 'WHOLE_DAY_PAIR__'

export type WholeDayTransferPair = { sourceDateKey: string; targetDateKey: string }

const DATE_KEY_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function buildWholeDayTransferPairKey(sourceDateKey: string, targetDateKey: string) {
  return `${WHOLE_DAY_PAIR_PREFIX}${sourceDateKey}__${targetDateKey}__0`
}

export function isWholeDayTransferPairKey(key: string) {
  return key.startsWith(WHOLE_DAY_PAIR_PREFIX)
}

/** 抑止キーの配列から組を読む（形の崩れたキー・同じ日を 2 つの組に使うキーは後のものを捨てる＝1 日は 1 つの組にしか属さない）。 */
export function parseWholeDayTransferPairs(keys: readonly string[] = []): WholeDayTransferPair[] {
  const pairs: WholeDayTransferPair[] = []
  const usedDates = new Set<string>()
  for (const key of keys) {
    if (!isWholeDayTransferPairKey(key)) continue
    const [sourceDateKey = '', targetDateKey = ''] = key.slice(WHOLE_DAY_PAIR_PREFIX.length).split('__')
    if (!DATE_KEY_PATTERN.test(sourceDateKey) || !DATE_KEY_PATTERN.test(targetDateKey) || sourceDateKey === targetDateKey) continue
    if (usedDates.has(sourceDateKey) || usedDates.has(targetDateKey)) continue
    usedDates.add(sourceDateKey)
    usedDates.add(targetDateKey)
    pairs.push({ sourceDateKey, targetDateKey })
  }
  return pairs
}

export function appendWholeDayTransferPair(keys: readonly string[], pair: WholeDayTransferPair): string[] {
  const key = buildWholeDayTransferPairKey(pair.sourceDateKey, pair.targetDateKey)
  return keys.includes(key) ? [...keys] : [...keys, key]
}

export function removeWholeDayTransferPair(keys: readonly string[], pair: WholeDayTransferPair): string[] {
  const key = buildWholeDayTransferPairKey(pair.sourceDateKey, pair.targetDateKey)
  return keys.filter((item) => item !== key)
}

/** その日が組の移動元・移動先のどちらかなら組を返す。 */
export function findWholeDayTransferPairForDate(keys: readonly string[], dateKey: string): (WholeDayTransferPair & { role: 'source' | 'target' }) | null {
  for (const pair of parseWholeDayTransferPairs(keys)) {
    if (pair.sourceDateKey === dateKey) return { ...pair, role: 'source' }
    if (pair.targetDateKey === dateKey) return { ...pair, role: 'target' }
  }
  return null
}

function weekdayOf(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(Date.UTC(year, (month ?? 1) - 1, day ?? 1)).getUTCDay()
}

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

/** 4-1: 移動先は移動元と同じ曜日だけ。違えば理由（null＝選べる）。 */
export function resolveWholeDayTransferPairWeekdayBlock(sourceDateKey: string, targetDateKey: string): string | null {
  const sourceWeekday = weekdayOf(sourceDateKey)
  const targetWeekday = weekdayOf(targetDateKey)
  if (sourceWeekday === targetWeekday) return null
  return `丸ごと振替の振替先は、振替元と同じ曜日の日だけ選べます（振替元 ${sourceDateKey} は${WEEKDAY_LABELS[sourceWeekday]}曜日、${targetDateKey} は${WEEKDAY_LABELS[targetWeekday]}曜日）。`
}

/**
 * 付け替えで D' に展開した生徒か（§1-1 #17・出自＝テンプレ（付け替え））。印 `wholeDayPairSourceDate` があり、科目・時間の手直しなどで
 * 手入力（origin='manual'）になっていないもの。別の日へ動かすと印は外れる（prepareStudentForMove）。
 */
export function isWholeDayPairExpandedStudent(student: Pick<StudentEntry, 'wholeDayPairSourceDate' | 'origin' | 'lessonType' | 'manualAdded' | 'makeupSourceDate' | 'editedToMakeup' | 'editedFromRegular'> | null | undefined): boolean {
  if (!student?.wholeDayPairSourceDate) return false
  // 手入力かどうかは出自の権威関数（placementOrigin.ts）で決める（ここで判定を写さない）。
  return !isManualOriginStudent(student)
}

/**
 * 回数表の「その授業を数える日」（4-8・決定記録 3）。付け替えの授業は移動元 D の日付、それ以外はコマの日付。
 * 生徒日程表（scheduleViewData / scheduleHtml の埋め込み版）が同じ規則を持つ（埋め込み版は文字列で写す）。
 */
export function resolveWholeDayPairCountDateKey(student: Pick<StudentEntry, 'wholeDayPairSourceDate'> | null | undefined, cellDateKey: string) {
  return student?.wholeDayPairSourceDate || cellDateKey
}

/** 振替元の表示ラベル（"2026/10/7(水) 5限"）の作り方。呼び出し側が在庫・移動と同じ formatStockOriginLabel を渡す（形を 2 か所で持たない）。 */
export type WholeDayPairOriginLabelFormatter = (dateKey: string, slotNumber: number) => string

/** D のテンプレの生徒を D' の付け替えの生徒にする（「振)」・出自 template・振替元 D の時限つき）。 */
export function convertToWholeDayPairStudent(student: StudentEntry, sourceDateKey: string, slotNumber: number, formatOriginLabel: WholeDayPairOriginLabelFormatter): StudentEntry {
  return {
    ...student,
    origin: 'template',
    lessonType: 'makeup',
    makeupSourceDate: sourceDateKey,
    makeupSourceLabel: formatOriginLabel(sourceDateKey, slotNumber),
    sameDayMoveSourceDate: undefined,
    sameDayMoveSourceLabel: undefined,
    wholeDayPairSourceDate: sourceDateKey,
  }
}

/**
 * 管理セル（テンプレの展開）を組で付け替える。sourceCellsBySlot＝D のテンプレ（D を開けた形で作ったもの・時限 → セル）。
 * - D' のセル: 机の中身を D のテンプレの同じ時限・同じ机番号のものに差し替える（D' 自身のテンプレは捨てる）。授業 ID は `managed_` のまま
 *   D' 用に付け直す（再マージがテンプレの授業として追従させる＝不動点）。D' が休日なら何も置かない（休日の扱いのまま）。
 * - D のセル: 机を空にする（テンプレの生徒も足場講師も置かない）。
 * 組の無い日のセルは参照ごと返す。
 */
export function applyWholeDayTransferPairToManagedCell(cell: SlotCell, params: {
  pair: WholeDayTransferPair & { role: 'source' | 'target' }
  sourceCellsBySlot: ReadonlyMap<number, SlotCell>
  formatOriginLabel: WholeDayPairOriginLabelFormatter
}): SlotCell {
  const emptyDesk = (desk: DeskCell): DeskCell => ({ id: desk.id, teacher: '' })
  if (params.pair.role === 'source') {
    return { ...cell, desks: cell.desks.map(emptyDesk) }
  }
  if (!cell.isOpenDay) return cell
  const sourceCell = params.sourceCellsBySlot.get(cell.slotNumber)
  const desks = cell.desks.map((desk, deskIndex): DeskCell => {
    const sourceDesk = sourceCell?.desks[deskIndex]
    if (!sourceDesk) return emptyDesk(desk)
    const next: DeskCell = { id: desk.id, teacher: sourceDesk.teacher }
    if (sourceDesk.teacherAssignmentTeacherId) next.teacherAssignmentTeacherId = sourceDesk.teacherAssignmentTeacherId
    if (sourceDesk.lesson) {
      const slots = sourceDesk.lesson.studentSlots.map((student) => (
        student ? convertToWholeDayPairStudent(student, params.pair.sourceDateKey, cell.slotNumber, params.formatOriginLabel) : null
      )) as [StudentEntry | null, StudentEntry | null]
      if (slots[0] || slots[1]) next.lesson = { ...sourceDesk.lesson, id: `${sourceDesk.lesson.id}__pair_${params.pair.targetDateKey}`, studentSlots: slots }
    }
    return next
  })
  return { ...cell, desks }
}

/** 付け替えの D に作った表示専用の「休)」記録か（作り直すときに外す・解除で外す）。 */
export function isWholeDayPairDerivedRecord(entry: StudentStatusEntry | null | undefined): boolean {
  return Boolean(entry?.wholeDayPairDerived)
}

/**
 * D のセルの「休)」記録を作り直す（純関数・入力は変えない）。前回作った記録（wholeDayPairDerived）を外し、D のテンプレの生徒の席が
 * 空いていて記録も無ければ、表示専用の移動元記録（moved・移動先＝D' の同じ時限）を置く。記録は会計を持たない（moved と同じ）。
 * recordedAt・ID は決定的に作る（再マージのたびに変わると不動点にならない＝INV-03）。
 */
export function deriveWholeDayPairSourceRecords(cell: SlotCell, params: {
  pair: WholeDayTransferPair
  templateDesks: readonly DeskCell[]
  buildRecord: (student: StudentEntry, desk: DeskCell) => StudentStatusEntry
  /** 付け替えに出さない生徒（D' で削除した・D で削除した）には記録を作らない。 */
  isExcluded: (student: StudentEntry) => boolean
}): SlotCell {
  let changed = false
  const desks = cell.desks.map((desk, deskIndex) => {
    const current = desk.statusSlots
    const cleared = current?.map((entry) => (isWholeDayPairDerivedRecord(entry) ? null : entry)) as [StudentStatusEntry | null, StudentStatusEntry | null] | undefined
    const templateDesk = params.templateDesks[deskIndex]
    const next: [StudentStatusEntry | null, StudentStatusEntry | null] = [cleared?.[0] ?? null, cleared?.[1] ?? null]
    templateDesk?.lesson?.studentSlots.forEach((student, seat) => {
      if (!student || params.isExcluded(student)) return
      if (next[seat] || desk.lesson?.studentSlots[seat]) return
      const record = params.buildRecord(student, { ...desk, teacher: templateDesk.teacher })
      next[seat] = {
        ...record,
        id: `wholedaypair_${params.pair.sourceDateKey}_${cell.slotNumber}_${deskIndex}_${seat}_${student.managedStudentId ?? student.id}_${student.subject}`,
        recordedAt: `${params.pair.sourceDateKey}T00:00:00.000Z`,
        sourceLessonId: templateDesk.lesson?.id ?? `wholedaypair_${params.pair.sourceDateKey}_${cell.slotNumber}_${deskIndex}`,
        moveDestinationDateKey: params.pair.targetDateKey,
        moveDestinationSlotNumber: cell.slotNumber,
        wholeDayPairDerived: true,
        wholeDayPairTargetDate: params.pair.targetDateKey,
      }
    })
    const nextSlots = next[0] || next[1] ? next : undefined
    if (sameStatusSlots(current, nextSlots)) return desk
    changed = true
    const { statusSlots: _dropped, ...rest } = desk
    void _dropped
    return nextSlots ? { ...rest, statusSlots: nextSlots } : rest
  })
  return changed ? { ...cell, desks } : cell
}

function sameStatusSlots(left: DeskCell['statusSlots'], right: DeskCell['statusSlots']) {
  const a = left ?? [null, null]
  const b = right ?? [null, null]
  return [0, 1].every((index) => JSON.stringify(a[index] ?? null) === JSON.stringify(b[index] ?? null))
}

/** 解除・作り直しの前に、D のセルから付け替えの「休)」記録だけを外す。 */
export function stripWholeDayPairDerivedRecords(cell: SlotCell): SlotCell {
  let changed = false
  const desks = cell.desks.map((desk) => {
    if (!desk.statusSlots?.some(isWholeDayPairDerivedRecord)) return desk
    changed = true
    const next = desk.statusSlots.map((entry) => (isWholeDayPairDerivedRecord(entry) ? null : entry)) as [StudentStatusEntry | null, StudentStatusEntry | null]
    const { statusSlots: _dropped, ...rest } = desk
    void _dropped
    return next[0] || next[1] ? { ...rest, statusSlots: next } : rest
  })
  return changed ? { ...cell, desks } : cell
}

/**
 * 盤面から読む「付け替えの移動先 D' の日付」（在庫の自動発生が D' 自身のテンプレを数えないため・監査 重大-2）。
 * 在庫の計算は抑止キーを受け取らないので、盤面に残る印（D の「休)」記録の移動先・D' の付け替えの授業）から読む。
 * D' を休日設定して付け替えの授業が D' から消えても、D の「休)」記録が移動先を持ち続ける。
 */
export function collectWholeDayPairTargetDates(weeks: readonly (readonly SlotCell[])[]): Set<string> {
  const dates = new Set<string>()
  for (const week of weeks) for (const cell of week) for (const desk of cell.desks) {
    for (const entry of desk.statusSlots ?? []) if (entry?.wholeDayPairDerived && entry.wholeDayPairTargetDate) dates.add(entry.wholeDayPairTargetDate)
    for (const student of desk.lesson?.studentSlots ?? []) if (student?.wholeDayPairSourceDate && student.lessonType === 'makeup') dates.add(cell.dateKey)
  }
  return dates
}

/** 出欠記録（付け替えの「休)」記録は数えない）がその日のセル群にあるか。 */
export function cellsHaveNonDerivedStatusEntries(cells: readonly SlotCell[]) {
  return cells.some((cell) => cell.desks.some((desk) => desk.statusSlots?.some((entry) => entry != null && !isWholeDayPairDerivedRecord(entry))))
}

/**
 * §9-21（オーナー決定 2026-11-05・監査 要確認-4）: D' の同じ時限に同じ生徒 S の手入力（上段・保留の下段）があり、§2-2 で D の S の授業を D' に置かない
 * ときは、D の S の記録を表示専用の「休)→D'」ではなく**休み**（absent・会計は通常の休みと同じ +1・在庫は記録から算出＝makeupStock の
 * collectAbsentMakeupOrigins）にし、振替先を持たせない。置けるようになったら「休)→D'」へ戻す。D と D' は別の週にあるので、週ごとの
 * 再マージの後に盤面全体で 1 回当てる（remergeBoardWeeksWithManagedData・テンプレの保存・付け替えの作成/解除の 3 か所）。何度当てても同じ（不動点）。
 */
export function settleWholeDayPairBlockedRecords(weeks: SlotCell[][], keys: readonly string[], pendingDesks?: TemplatePendingDeskMap | null): SlotCell[][] {
  const pairs = parseWholeDayTransferPairs(keys)
  if (pairs.length === 0) return weeks
  const cellsByDate = new Map<string, SlotCell[]>()
  for (const week of weeks) for (const cell of week) cellsByDate.set(cell.dateKey, [...(cellsByDate.get(cell.dateKey) ?? []), cell])
  const sameStudent = (left: Pick<StudentEntry, 'managedStudentId' | 'name'>, right: Pick<StudentEntry, 'managedStudentId' | 'name'>) => (
    left.managedStudentId && right.managedStudentId ? left.managedStudentId === right.managedStudentId : left.name === right.name
  )
  const manualOnTarget = (pair: WholeDayTransferPair, slotNumber: number, entry: StudentStatusEntry) => {
    const cell = (cellsByDate.get(pair.targetDateKey) ?? []).find((item) => item.slotNumber === slotNumber)
    if (!cell) return false
    return cell.desks.some((desk) => [
      ...(desk.lesson?.studentSlots ?? []),
      ...(pendingDesks?.[buildTemplatePendingDeskKey(cell.id, desk.id)]?.lower.lesson?.studentSlots ?? []),
    ].some((student) => Boolean(student) && !isWholeDayPairExpandedStudent(student) && isManualOriginStudent(student) && sameStudent(student!, entry)))
  }
  let changed = false
  const next = weeks.map((week) => week.map((cell) => {
    const pair = pairs.find((item) => item.sourceDateKey === cell.dateKey)
    if (!pair) return cell
    let cellChanged = false
    const desks = cell.desks.map((desk) => {
      if (!desk.statusSlots?.some(isWholeDayPairDerivedRecord)) return desk
      const statusSlots = desk.statusSlots.map((entry) => {
        if (!entry || !isWholeDayPairDerivedRecord(entry)) return entry
        const blocked = manualOnTarget(pair, cell.slotNumber, entry)
        if (blocked && entry.status !== 'absent') {
          const { moveDestinationDateKey: _date, moveDestinationSlotNumber: _slot, ...rest } = entry
          void _date
          void _slot
          cellChanged = true
          return { ...rest, status: 'absent' as const, id: entry.id.replace(/^wholedaypair_/, 'wholedaypairabsent_') }
        }
        if (!blocked && entry.status === 'absent') {
          cellChanged = true
          return { ...entry, status: 'moved' as const, id: entry.id.replace(/^wholedaypairabsent_/, 'wholedaypair_'), moveDestinationDateKey: pair.targetDateKey, moveDestinationSlotNumber: cell.slotNumber }
        }
        return entry
      }) as [StudentStatusEntry | null, StudentStatusEntry | null]
      return cellChanged ? { ...desk, statusSlots } : desk
    })
    if (!cellChanged) return cell
    changed = true
    return { ...cell, desks }
  }))
  return changed ? next : weeks
}
