// テンプレ差分反映の保留（2 行表示）を盤面で解決するための純関数（Issue #72・第 1 段 (B)・
// docs/spec-template-behavior.md §H Q26〜Q28・Q30・Q31）。
//
// ★台帳（在庫・希望回数・抑止）に触る部分はここに置かない。台帳の会計は既存の権威関数
//   （reconcileHolidayDeskStockReturns / resolveDeletedStudentCountAccounting / computeStudentMove 等）が
//   ScheduleBoardScreen.tsx にあるので、台帳つきの解決（computePendingDeskResolution / computePendingLowerStudentMove）は
//   そちらで組み立て、ここは「盤面の机と保留マップの形」だけを扱う（循環 import を避けるため）。
// ★保留中の下段は盤面画面専用（INV-13）。ここで作る「下段を机へ戻した」結果だけが週データへ入る。
// ★1 行へ戻す規則は computePendingDeskCollapse（templateDiffApply.ts・Q28）に一本化する。ここで別の合流規則を書かない。
//
// このファイルは純データ・純関数のみ（DOM / ネットワークに触らない）。

import type { DeskCell, SlotCell, StudentEntry } from './types'
import { alignTeacherIdentityWithRemerge, computePendingDeskCollapse, isSameTemplateStudent, type TemplatePendingCollapseResult } from './templateDiffApply'
import {
  buildTemplatePendingDeskKey,
  cloneTemplatePendingLower,
  hasTemplatePendingDesks,
  parseTemplatePendingDeskKey,
  type TemplatePendingDesk,
  type TemplatePendingDeskMap,
  type TemplatePendingLower,
} from './templatePendingDesks'

type StudentPair = [StudentEntry | null, StudentEntry | null]

function liveStudentsOf(lesson: DeskCell['lesson'] | undefined): StudentEntry[] {
  const slots: ReadonlyArray<StudentEntry | null> = lesson?.studentSlots ?? []
  return slots.filter((student): student is StudentEntry => Boolean(student))
}

function hasMemoText(memo: string | null | undefined) {
  return typeof memo === 'string' && memo.trim() !== ''
}

// ─────────────────────────────────────────────────────────────────────────────
// 引き当て
// ─────────────────────────────────────────────────────────────────────────────

export function findTemplatePendingDeskEntry(map: TemplatePendingDeskMap | null | undefined, cellId: string, deskId: string | undefined) {
  if (!map || !deskId) return null
  const key = buildTemplatePendingDeskKey(cellId, deskId)
  const entry = map[key]
  return entry ? { key, entry } : null
}

export function isTemplatePendingDeskAt(map: TemplatePendingDeskMap | null | undefined, cell: Pick<SlotCell, 'id' | 'desks'> | null | undefined, deskIndex: number) {
  if (!cell || !hasTemplatePendingDesks(map)) return false
  return Boolean(findTemplatePendingDeskEntry(map, cell.id, cell.desks[deskIndex]?.id))
}

function locateDesk(weeks: readonly SlotCell[][], cellId: string, deskId: string) {
  for (let weekIndex = 0; weekIndex < weeks.length; weekIndex += 1) {
    const week = weeks[weekIndex]
    for (let cellIndex = 0; cellIndex < week.length; cellIndex += 1) {
      const cell = week[cellIndex]
      if (cell.id !== cellId) continue
      const deskIndex = cell.desks.findIndex((desk) => desk.id === deskId)
      if (deskIndex < 0) return null
      return { weekIndex, cellIndex, deskIndex, cell, desk: cell.desks[deskIndex] }
    }
  }
  return null
}

/**
 * ツールバーのバッジ件数（Q30 第 1 段・条件 27）：保留マップのうち、盤面に存在する机を指し、
 * そのコマの日付が保留を作った反映日以降のものの数（机の数）。盤面に無い（孤児）キーは数えない（Q24-5 の整合チェックは第 2 段）。
 */
export function countTemplatePendingDesksOnBoard(map: TemplatePendingDeskMap | null | undefined, weeks: readonly SlotCell[][]) {
  if (!hasTemplatePendingDesks(map)) return 0
  const cellById = new Map<string, SlotCell>()
  for (const week of weeks) for (const cell of week) cellById.set(cell.id, cell)
  let count = 0
  for (const [key, entry] of Object.entries(map)) {
    const parsed = parseTemplatePendingDeskKey(key)
    if (!parsed) continue
    const cell = cellById.get(parsed.cellId)
    if (!cell || !cell.desks.some((desk) => desk.id === parsed.deskId)) continue
    if (entry.effectiveStartDate && cell.dateKey < entry.effectiveStartDate) continue
    count += 1
  }
  return count
}

/** その日の保留（机）の数。盤面に無い（孤児）キーは数えない。 */
export function countTemplatePendingDesksOnDate(map: TemplatePendingDeskMap | null | undefined, weeks: readonly SlotCell[][], dateKey: string) {
  if (!hasTemplatePendingDesks(map)) return 0
  const cellById = new Map<string, SlotCell>()
  for (const week of weeks) for (const cell of week) cellById.set(cell.id, cell)
  let count = 0
  for (const key of Object.keys(map)) {
    const parsed = parseTemplatePendingDeskKey(key)
    const cell = parsed ? cellById.get(parsed.cellId) : undefined
    if (!cell || cell.dateKey !== dateKey || !cell.desks.some((desk) => desk.id === parsed!.deskId)) continue
    count += 1
  }
  return count
}

/**
 * Q31（条件 28）：保留がある日に「休日設定」「生徒を空にする（全コマ削除）」「丸ごと振替」を実行しようとしたら止める理由。
 * 保留が無ければ null（＝従来どおり）。
 */
export function resolveTemplatePendingDateBlockReason(map: TemplatePendingDeskMap | null | undefined, weeks: readonly SlotCell[][], dateKey: string, actionLabel: string) {
  const count = countTemplatePendingDesksOnDate(map, weeks, dateKey)
  if (count === 0) return null
  return `${dateKey} には保留（2 行・緑）の机が ${count} 机あります。先に保留を片づけてください（${actionLabel}は実行しませんでした）。`
}

// ─────────────────────────────────────────────────────────────────────────────
// メニュー・操作の可否（Q26-2・Q26-3・Q26-5・Q27）
// ─────────────────────────────────────────────────────────────────────────────

export type TemplatePendingStudentAction = 'attend' | 'absent' | 'absent-no-makeup' | 'edit' | 'move' | 'store' | 'delete'

/**
 * 2 行の机の生徒メニューに出す操作（条件 18）。
 *  - 上段（テンプレの生徒）… 休み・振無休・移動・削除。**出席は出さない**（Q27）。編集・ストックへ戻すは出さない（Q26-2 の列挙どおり）。
 *  - 下段の生徒 … 削除・移動だけ（出席・休み・振無休は出さない・Q26-3）。
 *  - 下段がメモ（生徒なし）… 削除だけ。
 */
export function resolveTemplatePendingStudentMenuActions(row: 'upper' | 'lower', lowerContent: 'student' | 'memo' | 'none' = 'none'): TemplatePendingStudentAction[] {
  if (row === 'upper') return ['absent', 'absent-no-makeup', 'move', 'delete']
  if (lowerContent === 'student') return ['delete', 'move']
  if (lowerContent === 'memo') return ['delete']
  return []
}

export const TEMPLATE_PENDING_MESSAGES = {
  teacherLocked: '保留（2 行・緑）の机では講師を変更できません。先に「テンプレ授業を採用」「手入力データを採用」で片づけてください。',
  landingBlocked: '保留（2 行・緑）の席へは生徒を移動・配置できません。先に「テンプレ授業を採用」「手入力データを採用」で片づけてください。',
  attendBlocked: '保留（2 行・緑）の席では出席を付けられません。先に「テンプレ授業を採用」「手入力データを採用」で片づけてください。',
  lowerMoveNeedsEmptySeat: '保留の下段の生徒は、空いている席へだけ移動できます（入れ替えはできません）。',
  closedCell: '休校のコマへは移動できません。',
} as const

/**
 * Q26-5：他の机から 2 行の机への生徒の移動・D&D の着地・在庫からの配置を止める理由。
 * 同じ机の中の席の入れ替え（sourceDeskKey が同じ机）は止めない。保留でない机なら null。
 * seatIndex を渡すと席ごと（2026-10-02・Q34-12）: 保留に関わらない席（下段が無く、上段の生徒も下段と無関係）への着地は止めない。
 */
export function resolveTemplatePendingLandingBlock(map: TemplatePendingDeskMap | null | undefined, cell: Pick<SlotCell, 'id' | 'desks'> | null | undefined, deskIndex: number, sourceDeskKey?: string | null, seatIndex?: number) {
  if (!cell || !hasTemplatePendingDesks(map)) return null
  const desk = cell.desks[deskIndex]
  const found = findTemplatePendingDeskEntry(map, cell.id, desk?.id)
  if (!found || !desk) return null
  if (sourceDeskKey && sourceDeskKey === found.key) return null
  if (seatIndex !== undefined && !isTemplatePendingSeatLinked(desk, found.entry.lower, seatIndex)) return null
  return TEMPLATE_PENDING_MESSAGES.landingBlocked
}

// ─────────────────────────────────────────────────────────────────────────────
// 下段の編集（台帳なし）
// ─────────────────────────────────────────────────────────────────────────────

function normalizeLower(lower: TemplatePendingLower): TemplatePendingLower {
  const next: TemplatePendingLower = {}
  if (lower.lesson && liveStudentsOf(lower.lesson).length > 0) next.lesson = lower.lesson
  if (lower.statusSlots && (lower.statusSlots[0] || lower.statusSlots[1])) next.statusSlots = lower.statusSlots
  if (lower.memoSlots && (lower.memoSlots[0] != null || lower.memoSlots[1] != null)) next.memoSlots = lower.memoSlots
  return next
}

/** 下段から指定席の生徒を外す（入力は変えない）。外した生徒を返す。 */
export function removeTemplatePendingLowerStudents(entry: TemplatePendingDesk, studentIndices: readonly number[]): { nextEntry: TemplatePendingDesk; removed: StudentEntry[] } {
  const lower = cloneTemplatePendingLower(entry.lower)
  const removed: StudentEntry[] = []
  if (lower.lesson) {
    const slots = [...lower.lesson.studentSlots] as StudentPair
    for (const index of studentIndices) {
      const student = slots[index]
      if (!student) continue
      removed.push(student)
      slots[index] = null
    }
    lower.lesson = { ...lower.lesson, studentSlots: slots }
  }
  return { nextEntry: { ...entry, lower: normalizeLower(lower) }, removed }
}

/** 下段のメモを 1 つ消す（入力は変えない）。消すメモが無ければ null。 */
export function removeTemplatePendingLowerMemo(entry: TemplatePendingDesk, memoIndex: number): TemplatePendingDesk | null {
  if (!hasMemoText(entry.lower.memoSlots?.[memoIndex])) return null
  const lower = cloneTemplatePendingLower(entry.lower)
  const memo = [...(lower.memoSlots ?? [null, null])] as [string | null, string | null]
  memo[memoIndex] = null
  lower.memoSlots = memo
  return { ...entry, lower: normalizeLower(lower) }
}

/** 下段の中身の数（帯「保留 n」の n）＝生きている生徒＋出欠記録＋メモ。 */
export function countTemplatePendingLowerItems(lower: TemplatePendingLower) {
  return liveStudentsOf(lower.lesson).length
    + (lower.statusSlots ?? []).filter(Boolean).length
    + (lower.memoSlots ?? []).filter((memo) => hasMemoText(memo)).length
}

/**
 * 席ごとの保留表示（オーナー指示 2026-10-02・確認リスト v1.5.573 tp-19「生徒 1 と生徒 2 の保留状態がリンクしている」）:
 * その席の下段に中身（生きている生徒・出欠記録・メモ）があるか。無い席は 2 行にせず 1 行のまま描く（緑にもしない）。
 */
export function hasTemplatePendingLowerSeatContent(lower: TemplatePendingLower, seatIndex: number) {
  return Boolean(lower.lesson?.studentSlots[seatIndex])
    || Boolean(lower.statusSlots?.[seatIndex])
    || hasMemoText(lower.memoSlots?.[seatIndex])
}

/** 帯「保留 n」（狭い画面）を付ける席＝下段に中身のある最初の席。どの席にも無ければ 0（呼び出し側は描かない）。 */
export function resolveTemplatePendingBandSeat(lower: TemplatePendingLower) {
  return hasTemplatePendingLowerSeatContent(lower, 0) || !hasTemplatePendingLowerSeatContent(lower, 1) ? 0 : 1
}

/**
 * 席ごとの保留（オーナー決定 2026-10-02「席単位にする」・spec-template-behavior Q34-12）: その席が保留に関わるか。
 *  - 下段のその席に中身（生きている生徒・出欠記録・メモ）がある
 *  - 上段のその席の生徒が、下段の生きている生徒と同じ生徒（「既存を採用」で取り下げられる席＝resolveAdoptExistingWithdrawSeats と同じ条件）
 * 関わらない席は 1 行の席と同じ操作（出席・空席メニュー・移動／D&D／在庫からの配置の着地）ができる。講師欄のロックは机単位のまま
 * （保留マップのキーは机 ID・講師は机に 1 人）。
 */
export function isTemplatePendingSeatLinked(desk: Pick<DeskCell, 'lesson'>, lower: TemplatePendingLower, seatIndex: number) {
  if (hasTemplatePendingLowerSeatContent(lower, seatIndex)) return true
  const upper = desk.lesson?.studentSlots[seatIndex]
  if (!upper) return false
  return liveStudentsOf(lower.lesson).some((student) => isSameTemplateStudent(student, upper))
}

// ─────────────────────────────────────────────────────────────────────────────
// Q28：1 行に戻す（盤面への適用）
// ─────────────────────────────────────────────────────────────────────────────

export function describeTemplatePendingCollapseFailure(reason: Extract<TemplatePendingCollapseResult, { ok: false }>['reason']) {
  switch (reason) {
    case 'status-overflow':
    case 'memo-overflow':
      return '出欠記録・メモの席（2 つ）が足りないため 1 行に戻せません。先に下段を片づけてください。'
    case 'duplicate-student':
      return '同じコマに同じ生徒が 2 か所で生きることになるため 1 行に戻せません。先に上段側を片づけてください。'
    case 'both-rows-live':
      return '下段の生徒を戻す席（元の席）が空いていないため 1 行に戻せません。上段の生徒を削除・移動するか、「テンプレを採用」で片づけてください。'
  }
}

/** 同じコマの別の机で生きている生徒（Q26-4 の一意性検査に使う）。 */
export function collectLiveStudentsElsewhereInCell(cell: Pick<SlotCell, 'desks'>, deskId: string) {
  return cell.desks.filter((desk) => desk.id !== deskId).flatMap((desk) => liveStudentsOf(desk.lesson))
}

function replaceDesk(weeks: SlotCell[][], location: { weekIndex: number; cellIndex: number; deskIndex: number }, nextDesk: DeskCell): SlotCell[][] {
  return weeks.map((week, weekIndex) => (weekIndex !== location.weekIndex ? week : week.map((cell, cellIndex) => (
    cellIndex !== location.cellIndex ? cell : { ...cell, desks: cell.desks.map((desk, deskIndex) => (deskIndex === location.deskIndex ? nextDesk : desk)) }
  ))))
}

export type TemplatePendingSettleResult =
  | { status: 'unchanged' }
  | { status: 'collapsed'; nextWeeks: SlotCell[][]; nextTemplatePendingDesks: TemplatePendingDeskMap }
  | { status: 'kept'; reason: Extract<TemplatePendingCollapseResult, { ok: false }>['reason'] }

/**
 * 1 つの保留の机に Q28 を当てる：上段か下段のどちらかに生きている生徒がいなければ computePendingDeskCollapse で 1 行へ戻す。
 * 成功なら机を差し替えて保留マップからキーを消す（入力は変えない）。失敗なら 2 行のまま理由を返す。
 * 両方の行が生きていても、下段の生徒が全員元の席へ入るなら 1 行へ戻す（席ごと・2026-09-30。上段の生徒を削除して、または記録を残さずに
 * 動かしてその席が空いたとき。休み・振無休・別日への移動はその席に出欠記録〔absent / moved 等〕が残るので戻らない）。
 * 入らなければ何もしない（'unchanged'・利用者へは知らせない）。
 * 盤面に机が無い（孤児）キーは触らない（Q24-5）。
 */
export function settleTemplatePendingDesk(params: {
  weeks: SlotCell[][]
  templatePendingDesks: TemplatePendingDeskMap
  key: string
}): TemplatePendingSettleResult {
  const entry = params.templatePendingDesks[params.key]
  const parsed = parseTemplatePendingDeskKey(params.key)
  if (!entry || !parsed) return { status: 'unchanged' }
  const location = locateDesk(params.weeks, parsed.cellId, parsed.deskId)
  if (!location) return { status: 'unchanged' }
  const upperLive = liveStudentsOf(location.desk.lesson).length
  const lowerLive = liveStudentsOf(entry.lower.lesson).length
  const collapse = computePendingDeskCollapse(location.desk, entry, {
    liveStudentsElsewhere: collectLiveStudentsElsewhereInCell(location.cell, location.desk.id),
    dateKey: location.cell.dateKey,
  })
  if (!collapse.ok) return upperLive > 0 && lowerLive > 0 ? { status: 'unchanged' } : { status: 'kept', reason: collapse.reason }
  const nextTemplatePendingDesks = { ...params.templatePendingDesks }
  delete nextTemplatePendingDesks[params.key]
  // 下段を机へ戻した机は管理授業でない机になるので、再マージと同じ形（非 manual 講師の講師 id を外す）に揃えて不動点を保つ。
  return { status: 'collapsed', nextWeeks: replaceDesk(params.weeks, location, alignTeacherIdentityWithRemerge(collapse.nextDesk)), nextTemplatePendingDesks }
}

function isBothRowsLive(weeks: readonly SlotCell[][], map: TemplatePendingDeskMap, key: string) {
  const entry = map[key]
  const parsed = parseTemplatePendingDeskKey(key)
  if (!entry || !parsed) return false
  const location = locateDesk(weeks, parsed.cellId, parsed.deskId)
  if (!location) return false
  return liveStudentsOf(location.desk.lesson).length > 0 && liveStudentsOf(entry.lower.lesson).length > 0
}

// この確定で触られたコマか（regression-reviewer N-9(b)）。コマの机の中身が変わった、または保留の中身が変わったときだけ真。
// 同じコマの別の机も数える（Q26-4 の一意性検査は同じコマの別の机を見るので、別の机の操作で合流できるようになることがある）。
function isTouchedByCommit(
  previousCellById: ReadonlyMap<string, SlotCell>,
  cell: SlotCell | undefined,
  previousEntry: TemplatePendingDesk | undefined,
  entry: TemplatePendingDesk | undefined,
) {
  if (previousEntry !== entry && JSON.stringify(previousEntry) !== JSON.stringify(entry)) return true
  if (!cell) return false
  const previousCell = previousCellById.get(cell.id)
  if (!previousCell) return true
  if (previousCell === cell) return false
  return JSON.stringify(previousCell.desks) !== JSON.stringify(cell.desks)
}

/**
 * 盤面の確定（commitWeeks）ごとに、**この確定で触られたコマ**の保留の机へ Q28 を当てる（上段の休み・振無休・移動・削除で上段が空いた机を 1 行へ戻す）。
 * 何も変わらなければ入力と同じ参照を返す。
 * ★触られていないコマの保留は見ない（regression-reviewer N-9(b)・2026-09-29）。全保留を見ると、再マージ・リアルタイム同期など確定の外で
 *   上段が空いた別の机の 1 行戻しが、無関係な操作の Undo 1 段に同乗する（戻すと無関係な机まで 2 行へ戻る）。そうした机は、利用者がその
 *   コマを操作したとき、または採用ボタンで片づく。
 * newlyStuckKeys は「この確定の前は両方の行が生きていて、この確定で片方が空いたのに 1 行へ戻せなかった」机＝利用者へ理由を知らせる対象。
 * （保存直後から戻せずに残っている机〔席不足の下段など〕は毎回知らせない。）
 */
export function settleTemplatePendingDesksAfterCommit(params: {
  previousWeeks: readonly SlotCell[][]
  previousTemplatePendingDesks: TemplatePendingDeskMap
  weeks: SlotCell[][]
  templatePendingDesks: TemplatePendingDeskMap
}): {
  nextWeeks: SlotCell[][]
  nextTemplatePendingDesks: TemplatePendingDeskMap
  collapsedKeys: string[]
  newlyStuck: Array<{ key: string; reason: Extract<TemplatePendingCollapseResult, { ok: false }>['reason'] }>
} {
  let nextWeeks = params.weeks
  let nextTemplatePendingDesks = params.templatePendingDesks
  const collapsedKeys: string[] = []
  const newlyStuck: Array<{ key: string; reason: Extract<TemplatePendingCollapseResult, { ok: false }>['reason'] }> = []
  if (!hasTemplatePendingDesks(params.templatePendingDesks)) return { nextWeeks, nextTemplatePendingDesks, collapsedKeys, newlyStuck }
  const previousCellById = new Map<string, SlotCell>()
  for (const week of params.previousWeeks) for (const cell of week) previousCellById.set(cell.id, cell)
  const cellById = new Map<string, SlotCell>()
  for (const week of params.weeks) for (const cell of week) cellById.set(cell.id, cell)
  for (const key of Object.keys(params.templatePendingDesks)) {
    const parsed = parseTemplatePendingDeskKey(key)
    if (!parsed) continue
    if (!isTouchedByCommit(previousCellById, cellById.get(parsed.cellId), params.previousTemplatePendingDesks[key], params.templatePendingDesks[key])) continue
    const result = settleTemplatePendingDesk({ weeks: nextWeeks, templatePendingDesks: nextTemplatePendingDesks, key })
    if (result.status === 'collapsed') {
      nextWeeks = result.nextWeeks
      nextTemplatePendingDesks = result.nextTemplatePendingDesks
      collapsedKeys.push(key)
    } else if (result.status === 'kept' && isBothRowsLive(params.previousWeeks, params.previousTemplatePendingDesks, key)) {
      newlyStuck.push({ key, reason: result.reason })
    }
  }
  return { nextWeeks, nextTemplatePendingDesks, collapsedKeys, newlyStuck }
}
