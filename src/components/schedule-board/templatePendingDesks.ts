// テンプレ差分反映の「保留（2 行表示）」の下段を持つ別マップ（Issue #72・docs/spec-template-behavior.md §H Q24）。
//
// ★下段は机(DeskCell)の中に入れない。週データだけを読む消費者（日程表・PDF・保護者向け表示・盤面共有・回数・給与）は
//   自動で下段を見ない＝INV-13（保留中の下段は盤面専用）。逆に下段を**見なければならない**消費者は、在庫の消化・
//   欠席由来の走査（INV-06 の 3 本目の走査対象＝buildTemplatePendingLowerScanWeeks）と、週トリムの保持判定
//   （collectTemplatePendingCellIds）。「盤面の表示のために下段を週データへ混ぜる」近道は全消費者へ漏れるので禁止。
//
// ★配線（Q24-3・spec-makeup-stock.md §B-2-3 の「新フィールドは約 40 箇所の配線が要り、1 つ漏れると黙って消える」）:
//   PersistedBoardState 型 / workspaceStore の分割読込(boardStock の Pick) / App のダーティ署名 /
//   onBoardStateChange の publish 全経路（commitWeeks・publish effect・undo/redo〔applyHistoryEntry〕・テンプレ保存）/
//   履歴エントリ(HistoryEntry) / 初期スナップショット(createInitialBoardSnapshot) / JSON スナップショット・自動バックアップ・
//   一段復元・リアルタイム同期（いずれも boardState を丸ごと spread するので型に載れば通る）/ 週トリム。
//   配線テストは templatePendingDesks.wiring.test.ts。
//
// ★フラグ（templateDiffApply）に依らず、**既に存在する保留データの保存・往復は常に有効**（Q33-3）。
//   フラグを戻した教室で黙って消さない（transferSourceRestDisplay と同じ流儀）。
//
// このファイルは純データ・純関数のみ（DOM / ネットワークに触らない）。

import type { DeskLesson, SlotCell, StudentEntry, StudentStatusEntry } from './types'

/** 保留の下段（既存側の生徒側）。講師は持たない（Q24-1・Q21-9）。 */
export type TemplatePendingLower = {
  /** 保存前の机の生きている生徒（lesson.studentSlots）。生きている生徒がいなければ undefined。 */
  lesson?: DeskLesson
  /**
   * 下段に入った出欠記録。表示専用（moved / holiday）と、席不足（Q21-10）であふれた会計記録
   * （absent / absent-no-makeup / attended）。会計記録は在庫の走査で下段も数える（Q25-4・INV-06）。
   */
  statusSlots?: [StudentStatusEntry | null, StudentStatusEntry | null]
  /** 下段のメモ。 */
  memoSlots?: [string | null, string | null]
}

export type TemplatePendingDesk = {
  lower: TemplatePendingLower
  /** 保留を作ったテンプレ保存の反映日。 */
  effectiveStartDate: string
  /** 保留を作った日時（ISO）。 */
  createdAt: string
}

/** キー＝`"<cellId>::<deskId>"`（Q24-1・オーナー確定）。 */
export type TemplatePendingDeskMap = Record<string, TemplatePendingDesk>

const KEY_SEPARATOR = '::'

export function buildTemplatePendingDeskKey(cellId: string, deskId: string) {
  return `${cellId}${KEY_SEPARATOR}${deskId}`
}

export function parseTemplatePendingDeskKey(key: string): { cellId: string; deskId: string } | null {
  const index = key.indexOf(KEY_SEPARATOR)
  if (index <= 0) return null
  return { cellId: key.slice(0, index), deskId: key.slice(index + KEY_SEPARATOR.length) }
}

export function hasTemplatePendingDesks(map: TemplatePendingDeskMap | null | undefined): map is TemplatePendingDeskMap {
  return Boolean(map) && Object.keys(map as TemplatePendingDeskMap).length > 0
}

function cloneStudentSlots(slots: [StudentEntry | null, StudentEntry | null]): [StudentEntry | null, StudentEntry | null] {
  return [slots[0] ? { ...slots[0] } : null, slots[1] ? { ...slots[1] } : null]
}

function cloneStatusSlots(slots: [StudentStatusEntry | null, StudentStatusEntry | null]): [StudentStatusEntry | null, StudentStatusEntry | null] {
  return [
    slots[0] ? { ...slots[0], ...(slots[0].holidayStockReturn ? { holidayStockReturn: { ...slots[0].holidayStockReturn } } : {}) } : null,
    slots[1] ? { ...slots[1], ...(slots[1].holidayStockReturn ? { holidayStockReturn: { ...slots[1].holidayStockReturn } } : {}) } : null,
  ]
}

export function cloneTemplatePendingLower(lower: TemplatePendingLower): TemplatePendingLower {
  return {
    ...(lower.lesson ? { lesson: { ...lower.lesson, studentSlots: cloneStudentSlots(lower.lesson.studentSlots) } } : {}),
    ...(lower.statusSlots ? { statusSlots: cloneStatusSlots(lower.statusSlots) } : {}),
    ...(lower.memoSlots ? { memoSlots: [lower.memoSlots[0], lower.memoSlots[1]] as [string | null, string | null] } : {}),
  }
}

export function cloneTemplatePendingDeskMap(map: TemplatePendingDeskMap | null | undefined): TemplatePendingDeskMap {
  if (!map) return {}
  const result: TemplatePendingDeskMap = {}
  for (const [key, entry] of Object.entries(map)) {
    result[key] = {
      lower: cloneTemplatePendingLower(entry.lower),
      effectiveStartDate: entry.effectiveStartDate,
      createdAt: entry.createdAt,
    }
  }
  return result
}

function isPair(value: unknown): value is [unknown, unknown] {
  return Array.isArray(value) && value.length === 2
}

// 読込時の防御的な正規化。**形が壊れた値だけ**落とし、キーが盤面の机を指していない（孤児）エントリは落とさない
// （Q24-5「黙って捨てない」。孤児の検出は開発者向けの整合チェック＝第 2 段）。
export function normalizeTemplatePendingDeskMap(value: unknown): TemplatePendingDeskMap {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return {}
  const result: TemplatePendingDeskMap = {}
  for (const [key, raw] of Object.entries(value as Record<string, unknown>)) {
    if (!parseTemplatePendingDeskKey(key)) continue
    if (!raw || typeof raw !== 'object') continue
    const entry = raw as Record<string, unknown>
    const rawLower = entry.lower
    if (!rawLower || typeof rawLower !== 'object') continue
    const lowerRecord = rawLower as Record<string, unknown>
    const lower: TemplatePendingLower = {}
    const lesson = lowerRecord.lesson as DeskLesson | undefined
    if (lesson && typeof lesson === 'object' && typeof lesson.id === 'string' && isPair(lesson.studentSlots)) {
      lower.lesson = { ...lesson, studentSlots: cloneStudentSlots(lesson.studentSlots) }
    }
    if (isPair(lowerRecord.statusSlots)) {
      lower.statusSlots = cloneStatusSlots(lowerRecord.statusSlots as [StudentStatusEntry | null, StudentStatusEntry | null])
    }
    if (isPair(lowerRecord.memoSlots)) {
      const memo = lowerRecord.memoSlots as [unknown, unknown]
      lower.memoSlots = [typeof memo[0] === 'string' ? memo[0] : null, typeof memo[1] === 'string' ? memo[1] : null]
    }
    result[key] = {
      lower,
      effectiveStartDate: typeof entry.effectiveStartDate === 'string' ? entry.effectiveStartDate : '',
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : '',
    }
  }
  return result
}

// publish / 初期スナップショットに載せる形。**空なら項目ごと載せない**（保留の無い教室＝本番 3 教室の保存内容・
// ダーティ署名・既存のスナップショットテストを 1 バイトも変えないため）。
export function buildTemplatePendingDesksPayload(map: TemplatePendingDeskMap | null | undefined): { templatePendingDesks?: TemplatePendingDeskMap } {
  return hasTemplatePendingDesks(map) ? { templatePendingDesks: cloneTemplatePendingDeskMap(map) } : {}
}

// App のダーティ署名用。空と未設定を同一視する（読み込み直後の {} / undefined の差で「未保存」にしない）。
export function templatePendingDesksForSignature(map: TemplatePendingDeskMap | null | undefined): TemplatePendingDeskMap | undefined {
  return hasTemplatePendingDesks(map) ? map : undefined
}

// 旧方式（上書き・フラグ OFF）でテンプレ保存したとき、反映日以降の保留を消す（Q33-3「上書きで机ごと消えるため」）。
// 反映日より前のコマの保留は触らない（Q1）。コマの日付はキーのセル ID から引けないので、盤面の週から引く。
// 盤面に見つからない（孤児）キーは消さない（Q24-5）。
export function pruneTemplatePendingDesksOnOrAfter(map: TemplatePendingDeskMap, weeks: SlotCell[][], effectiveStartDate: string): TemplatePendingDeskMap {
  if (!hasTemplatePendingDesks(map)) return map
  const dateKeyByCellId = new Map<string, string>()
  for (const week of weeks) for (const cell of week) dateKeyByCellId.set(cell.id, cell.dateKey)
  let changed = false
  const next: TemplatePendingDeskMap = {}
  for (const [key, entry] of Object.entries(map)) {
    const parsed = parseTemplatePendingDeskKey(key)
    const dateKey = parsed ? dateKeyByCellId.get(parsed.cellId) : undefined
    if (dateKey && dateKey >= effectiveStartDate) {
      changed = true
      continue
    }
    next[key] = entry
  }
  return changed ? next : map
}

// 週トリム（trimBoardWeeksForMemory）で保持すべきコマ ID（Q24-4・破棄すると保留マップのキーが宙に浮く）。
export function collectTemplatePendingCellIds(map: TemplatePendingDeskMap | null | undefined): Set<string> {
  const ids = new Set<string>()
  if (!map) return ids
  for (const key of Object.keys(map)) {
    const parsed = parseTemplatePendingDeskKey(key)
    if (parsed) ids.add(parsed.cellId)
  }
  return ids
}

// INV-06（在庫の実態一致・2026-09-29 拡張）/ spec-template-behavior Q25-4:
// 在庫の**消化**（振替コマ）と**欠席由来の在庫**（absent 記録）の走査に、保留の下段を 3 本目の走査対象として加えるための
// 疑似セル。盤面の週の後ろへ足して、消化・欠席由来の走査関数（collectMakeupUsageByKey / collectAbsentMakeupOrigins）
// **だけ**に渡す。発生（テンプレを根拠にした自動振替元）・回数・日程表には渡さない（INV-13）。
// 開校判定はキーのコマ（盤面のセル）から引く。盤面に無い（孤児）キーは開校扱いで数える（消化済みを未消化へ戻さない安全側）。
export function buildTemplatePendingLowerScanWeeks(weeks: SlotCell[][], map: TemplatePendingDeskMap | null | undefined): SlotCell[][] {
  if (!hasTemplatePendingDesks(map)) return []
  const cellById = new Map<string, SlotCell>()
  for (const week of weeks) for (const cell of week) cellById.set(cell.id, cell)
  const cells: SlotCell[] = []
  for (const [key, entry] of Object.entries(map)) {
    const parsed = parseTemplatePendingDeskKey(key)
    if (!parsed) continue
    const boardCell = cellById.get(parsed.cellId)
    const lower = entry.lower
    if (!lower.lesson && !lower.statusSlots) continue
    cells.push({
      id: `${parsed.cellId}__template_pending_lower__${parsed.deskId}`,
      dateKey: boardCell?.dateKey ?? '',
      dayLabel: boardCell?.dayLabel ?? '',
      dateLabel: boardCell?.dateLabel ?? '',
      slotLabel: boardCell?.slotLabel ?? '',
      slotNumber: boardCell?.slotNumber ?? 0,
      timeLabel: boardCell?.timeLabel ?? '',
      isOpenDay: boardCell ? boardCell.isOpenDay : true,
      desks: [{
        id: parsed.deskId,
        teacher: '',
        ...(lower.statusSlots ? { statusSlots: lower.statusSlots } : {}),
        ...(lower.lesson ? { lesson: lower.lesson } : {}),
      }],
    })
  }
  return cells.length > 0 ? [cells] : []
}
