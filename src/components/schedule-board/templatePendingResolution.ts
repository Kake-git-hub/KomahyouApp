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

import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from './types'
import { alignTeacherIdentityWithRemerge, applyTemplatePendingLowerTeacherToDesk, computePendingDeskCollapse, isSameTemplateStudent, type TemplatePendingCollapseResult, isTeacherElsewhereInCell } from './templateDiffApply'
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
  return `${dateKey} に保留の机が ${count} 机あるため、${actionLabel}は中止しました。`
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
  teacherLocked: '保留の机は講師を変えられません。先に保留を片づけてください。',
  /** tp-64（2026-10-27）: 下段に手置き講師が残っている机（講師欄のロック・生徒の保留を片づけた後に講師の選択が残るとき）。 */
  teacherChoiceRemains: '講師はまだ選んでいません。緑の下の行の講師を押して、テンプレの講師か手入力の講師かを選んでください。',
  landingBlocked: '保留の席へは移動・配置できません。先に保留を片づけてください。',
  attendBlocked: '保留の席は出席を付けられません。先に保留を片づけてください。',
  lowerMoveNeedsEmptySeat: '下段の生徒は空いている席へだけ移動できます。',
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
  // 講師と生徒を別々に採用（オーナー確定 2026-10-27・確認リスト tp-64）: 下段の手置き講師は、生徒の操作（採用・削除・移動）では外れない。
  // 講師欄の「テンプレの講師を採用／手入力の講師を採用」（computePendingTeacherChoice）でだけ外れる。生徒が全部片づいても講師だけで保留に残る。
  if (lower.teacher?.teacher.trim()) next.teacher = lower.teacher
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

/**
 * 席ごとの採用（オーナー指示 2026-10-03・確認リスト v1.5.577 その他欄「生徒 1 の手入力データを採用したのに生徒 2 の既存データが
 * 生徒 2 のテンプレを上書きしている」「生徒 1 と生徒 2 がデータリンクしちゃっている気がします。完全に独立させて」・Q26-10）:
 * 下段をその席の分（seatLower）と残り（restLower）に分ける。入力は変えない。
 */
export function splitTemplatePendingLowerSeat(lower: TemplatePendingLower, seatIndex: number): { seatLower: TemplatePendingLower; restLower: TemplatePendingLower } {
  const other = seatIndex === 0 ? 1 : 0
  const pick = (keep: number): TemplatePendingLower => {
    const next: TemplatePendingLower = {}
    const student = lower.lesson?.studentSlots[keep] ?? null
    if (lower.lesson && student) {
      const slots: StudentPair = [null, null]
      slots[keep] = { ...student }
      next.lesson = { ...lower.lesson, studentSlots: slots }
    }
    const record = lower.statusSlots?.[keep] ?? null
    if (record) {
      const slots: [StudentStatusEntry | null, StudentStatusEntry | null] = [null, null]
      slots[keep] = { ...record }
      next.statusSlots = slots
    }
    const memo = lower.memoSlots?.[keep] ?? null
    if (memo != null) {
      const slots: [string | null, string | null] = [null, null]
      slots[keep] = memo
      next.memoSlots = slots
    }
    return normalizeLower(next)
  }
  // tp-64（2026-10-27）: 講師はどちらの分け前にも入れない（席の操作は講師に触れない）。残す保留へ講師を付け直すのは呼び出し側（withTemplatePendingTeacherChoice）。
  return { seatLower: pick(seatIndex), restLower: pick(other) }
}

/** 下段に中身（生きている生徒・出欠記録・メモ）が 1 つでもあるか。 */
export function hasTemplatePendingLowerContent(lower: TemplatePendingLower) {
  return hasTemplatePendingLowerSeatContent(lower, 0) || hasTemplatePendingLowerSeatContent(lower, 1)
}

/**
 * 「テンプレ授業を採用」を席ごとに（Q26-10）: 押した席の下段の生徒・メモ・表示専用の記録を捨てる。会計を持つ記録（席不足で下段へ入った出席）は
 * 捨てずに下段へ残す（INV-06。1 行へ戻るとき Q28 で机へ戻る）。外した生徒を返す（在庫の会計は呼び出し側）。
 */
export function clearTemplatePendingLowerSeatForAdopt(entry: TemplatePendingDesk, seatIndex: number): { nextEntry: TemplatePendingDesk; removed: StudentEntry[] } {
  const { nextEntry, removed } = removeTemplatePendingLowerStudents(entry, [seatIndex])
  const lower = cloneTemplatePendingLower(nextEntry.lower)
  if (lower.memoSlots) {
    const memo = [...lower.memoSlots] as [string | null, string | null]
    memo[seatIndex] = null
    lower.memoSlots = memo
  }
  const record = lower.statusSlots?.[seatIndex]
  if (lower.statusSlots && record && (record.status === 'moved' || record.status === 'holiday')) {
    const slots = [...lower.statusSlots] as [StudentStatusEntry | null, StudentStatusEntry | null]
    slots[seatIndex] = null
    lower.statusSlots = slots
  }
  return { nextEntry: { ...nextEntry, lower: normalizeLower(lower) }, removed }
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

/** 1 席分の下段の中身の数（狭い画面の帯「保留 n」の n・席ごと）。 */
export function countTemplatePendingLowerSeatItems(lower: TemplatePendingLower, seatIndex: number) {
  return (lower.lesson?.studentSlots[seatIndex] ? 1 : 0) + (lower.statusSlots?.[seatIndex] ? 1 : 0) + (hasMemoText(lower.memoSlots?.[seatIndex]) ? 1 : 0)
}

/** 下段に中身のある最初の席（上段メニューの「保留を片づける」の既定の対象）。どの席にも無ければ 0。 */
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
      return '出欠・メモの席が足りません。先に下段を片づけてください。'
    case 'duplicate-student':
      return '同じ生徒が 2 か所になります。先に上段を片づけてください。'
    case 'both-rows-live':
      return '元の席が空いていません。上段の生徒を動かすか「テンプレを採用」を選んでください。'
  }
}

/**
 * 生徒の席の片づけの後に残す保留（講師と生徒を別々に採用・オーナー確定 2026-10-27・確認リスト tp-64）。
 * lower（生徒・記録・メモの残り。講師は見ない）に中身があればそれに元の保留の手置き講師を付け直し、中身が無くても手置き講師が居れば講師だけの保留を残す。
 * どちらも無ければ null（保留を消して 1 行へ）。入力は変えない。
 */
export function withTemplatePendingTeacherChoice(entry: TemplatePendingDesk, lower: TemplatePendingLower | null): TemplatePendingDesk | null {
  const teacher = entry.lower.teacher?.teacher.trim() ? { ...entry.lower.teacher } : undefined
  const rest: TemplatePendingLower = lower && hasTemplatePendingLowerContent(lower) ? cloneTemplatePendingLower(lower) : {}
  delete rest.teacher
  if (teacher) rest.teacher = teacher
  if (!hasTemplatePendingLowerContent(rest) && !rest.teacher) return null
  return { ...entry, lower: rest }
}

/** 下段が講師だけ（生徒・記録・メモが無く、手置き講師の選択だけが残る）か（tp-64）。 */
export function isTemplatePendingTeacherOnly(lower: TemplatePendingLower) {
  return Boolean(lower.teacher?.teacher.trim()) && !hasTemplatePendingLowerContent(lower)
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
  /** teacherPending＝生徒の側は 1 行に戻ったが、講師の選択（下段の手置き講師）が残っているので保留は講師だけで残した（tp-64）。 */
  | { status: 'collapsed'; nextWeeks: SlotCell[][]; nextTemplatePendingDesks: TemplatePendingDeskMap; teacherPending: boolean }
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
  // tp-64（2026-10-27）: 講師だけの保留（生徒の側は片づき済み）は、講師欄の選択でだけ解ける。自動では何もしない。
  if (isTemplatePendingTeacherOnly(entry.lower)) return { status: 'unchanged' }
  const upperLive = liveStudentsOf(location.desk.lesson).length
  const lowerLive = liveStudentsOf(entry.lower.lesson).length
  // Q41-7（2026-10-27 改定・tp-64）: 上段が空いて下段の生徒が机へ戻っても、机の講師は変えない（手置き講師は講師だけの保留に残る）。
  const collapse = computePendingDeskCollapse(location.desk, entry, {
    liveStudentsElsewhere: collectLiveStudentsElsewhereInCell(location.cell, location.desk.id),
    dateKey: location.cell.dateKey,
  })
  if (!collapse.ok) return upperLive > 0 && lowerLive > 0 ? { status: 'unchanged' } : { status: 'kept', reason: collapse.reason }
  const nextTemplatePendingDesks = { ...params.templatePendingDesks }
  const remaining = withTemplatePendingTeacherChoice(entry, null)
  if (remaining) nextTemplatePendingDesks[params.key] = remaining
  else delete nextTemplatePendingDesks[params.key]
  // 下段を机へ戻した机は管理授業でない机になるので、再マージと同じ形（非 manual 講師の講師 id を外す）に揃えて不動点を保つ。
  return { status: 'collapsed', nextWeeks: replaceDesk(params.weeks, location, alignTeacherIdentityWithRemerge(collapse.nextDesk)), nextTemplatePendingDesks, teacherPending: Boolean(remaining) }
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

// ─────────────────────────────────────────────────────────────────────────────
// 講師の選択（講師と生徒を別々に採用・オーナー確定 2026-10-27・確認リスト tp-64）
// ─────────────────────────────────────────────────────────────────────────────

/** 'template'＝テンプレの講師を採用（机の講師のまま・手置き講師を外す）／'manual'＝手入力の講師を採用（机の講師を手置き講師にする）。 */
export type TemplatePendingTeacherChoice = 'template' | 'manual'

export type TemplatePendingTeacherChoiceResult =
  | { status: 'blocked'; message: string }
  | { status: 'applied'; nextWeeks: SlotCell[][]; nextTemplatePendingDesks: TemplatePendingDeskMap; collapsed: boolean; message: string }

/** 手置き講師が同じコマの別の机に居ればその机番号（1 始まり）。居なければ null。判定は講師の一意性検査と同じ isTeacherElsewhereInCell。 */
export function findTemplatePendingTeacherElsewhereDeskNumber(cell: Pick<SlotCell, 'desks'>, deskId: string, teacher: TemplatePendingLower['teacher']) {
  if (!teacher?.teacher.trim()) return null
  const index = cell.desks.findIndex((other) => other.id !== deskId && isTeacherElsewhereInCell({ desks: [other] }, deskId, teacher))
  return index >= 0 ? index + 1 : null
}

/** 講師欄の確認文（実行する前に出す・Q32-1 の流儀で名前は本体と同じものを使う）。講師の選択が無い机は ''。 */
export function buildTemplatePendingTeacherChoiceConfirm(desk: Pick<DeskCell, 'teacher' | 'lesson'>, entry: TemplatePendingDesk, choice: TemplatePendingTeacherChoice) {
  const manualName = entry.lower.teacher?.teacher.trim()
  if (!manualName) return ''
  const templateName = desk.teacher.trim() || 'なし'
  if (choice === 'template') return `テンプレの講師 ${templateName} を採用します。手で置いた講師 ${manualName} はこの机から外れます。よろしいですか？`
  const upperNote = liveStudentsOf(desk.lesson).length > 0 ? `この机の生徒は ${manualName} の担当になります。` : ''
  return `手入力の講師 ${manualName} を採用します。テンプレの講師 ${templateName} はこの机から外れます。${upperNote}よろしいですか？`
}

/**
 * 講師欄の「テンプレの講師を採用／手入力の講師を採用」（tp-64）。生徒（上段・下段）には触れない。純関数・入力は変えない。
 *  - template … 机の講師（テンプレの講師）のまま、下段の手置き講師を外す。
 *  - manual   … 机の講師を手置き講師にする（manual のまま・再マージで変わらない＝INV-02）。手置き講師が同じコマの別の机に居れば止める
 *               （同じ講師を 2 机にしない＝INV-01。理由は確認の前に出す）。
 * 講師を外した後、下段に生徒・記録・メモが残れば保留は続く（残りに Q28 を当て、戻れるなら 1 行へ）。何も残らなければ 1 行へ戻る。
 */
export function computePendingTeacherChoice(params: {
  weeks: SlotCell[][]
  templatePendingDesks: TemplatePendingDeskMap
  cellId: string
  deskId: string
  choice: TemplatePendingTeacherChoice
}): TemplatePendingTeacherChoiceResult {
  const found = findTemplatePendingDeskEntry(params.templatePendingDesks, params.cellId, params.deskId)
  const location = locateDesk(params.weeks, params.cellId, params.deskId)
  if (!found || !location) return { status: 'blocked', message: '保留の机が見つかりませんでした。表示を更新してから操作してください。' }
  const teacher = found.entry.lower.teacher
  const manualName = teacher?.teacher.trim()
  if (!teacher || !manualName) return { status: 'blocked', message: 'この机には選ぶ講師がありません。' }
  const templateName = location.desk.teacher.trim() || 'なし'
  let nextWeeks = params.weeks
  if (params.choice === 'manual') {
    const elsewhere = findTemplatePendingTeacherElsewhereDeskNumber(location.cell, location.desk.id, teacher)
    if (elsewhere !== null) {
      return { status: 'blocked', message: `手入力の講師を採用できません。講師 ${manualName} が同じコマの机 ${elsewhere} に居ます（同じ講師を 2 つの机に置けません）。「テンプレの講師を採用」を選ぶか、机 ${elsewhere} の講師を片づけてから選んでください。` }
    }
    nextWeeks = replaceDesk(params.weeks, location, alignTeacherIdentityWithRemerge(applyTemplatePendingLowerTeacherToDesk(location.desk, teacher)))
  }
  const restLower = cloneTemplatePendingLower(found.entry.lower)
  delete restLower.teacher
  let nextTemplatePendingDesks: TemplatePendingDeskMap = { ...params.templatePendingDesks }
  let collapsed = false
  if (hasTemplatePendingLowerContent(restLower)) {
    nextTemplatePendingDesks[found.key] = { ...found.entry, lower: restLower }
    // 講師の重複が解けたので、残った生徒の側に Q28 を当てる（戻れるなら 1 行へ）。
    const settled = settleTemplatePendingDesk({ weeks: nextWeeks, templatePendingDesks: nextTemplatePendingDesks, key: found.key })
    if (settled.status === 'collapsed') {
      nextWeeks = settled.nextWeeks
      nextTemplatePendingDesks = settled.nextTemplatePendingDesks
      collapsed = true
    }
  } else {
    delete nextTemplatePendingDesks[found.key]
    collapsed = true
  }
  const head = params.choice === 'template'
    ? `テンプレの講師 ${templateName} を採用しました（手で置いた講師 ${manualName} は外す）。`
    : `手入力の講師 ${manualName} を採用しました（テンプレの講師 ${templateName} は外す）。`
  return { status: 'applied', nextWeeks, nextTemplatePendingDesks, collapsed, message: `${head}${collapsed ? '1 行に戻しました。' : '生徒の保留は残っています。'}` }
}
