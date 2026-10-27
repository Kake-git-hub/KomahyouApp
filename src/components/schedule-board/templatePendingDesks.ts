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

import type { DeskCell, DeskLesson, SlotCell, StudentEntry, StudentStatusEntry } from './types'

type StudentPair = [StudentEntry | null, StudentEntry | null]

/** 下段が持つ手置き講師（Q41・2026-10-21・オーナー決定 B）。保存前の机の講師フィールドの写し。表示と「既存を採用」の復元にだけ使う（INV-13）。 */
export type TemplatePendingLowerTeacher = Pick<DeskCell, 'teacher' | 'manualTeacher' | 'teacherAssignmentSource' | 'teacherAssignmentSessionId' | 'teacherAssignmentTeacherId'>

/** 保留の下段（既存側の生徒側）。講師は原則持たない（Q24-1・Q21-9）。例外＝Q41 の手置き講師（`teacher`）。 */
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
  /**
   * Q41（2026-10-21・オーナー決定 B）: 手置き講師の机に手で置いた生徒が居て、テンプレが別の講師（＋生徒）を同じ机に置くとき、
   * 手置き講師を下段に残す（講師の重複として緑で見せる）。講師日程表・給与・PDF・警告など週データの消費者には出ない（INV-13）。
   * 「既存を採用」で机の講師に戻す。下段が空になれば消える。
   */
  teacher?: TemplatePendingLowerTeacher
}

/**
 * 保留を作った自動処理の種別（決定記録 48・2026-10-25・docs/plan-2026-10-25-conflict-placement.md §3）。
 * 自動処理が授業を本来の机に置けないとき、消さず・隠さず・別の場所へ逃がさず、その机の下段（保留・緑）に残す。
 * 色は既存の保留と同じ緑。種別の区別は理由文（ツールチップ・確認の画面）だけ。未設定＝従来どおりテンプレ保存の保留。
 *  - whole-day-transfer-displaced … 丸ごと振替の振替先に室長が置いていた体験・増コマ・手動追加で、移送後のコマに空き席が無かったもの（(a)）。
 *  - transfer-follow-full        … Q40-2 で丸ごと振替した日に足した生徒の振替先のコマが満席だったもの（(b)-1）。
 *  - holiday-release-seat-taken  … 休日解除で戻す席に別の生徒が居たもの（(b)-2）。
 *  - slot-follow-full            … 時限変更の追従（決定記録 46・§H Q40-9）で新しい時限が満席だったもの（(b)-3・v1.5.643）。
 */
export type TemplatePendingOriginKind = 'whole-day-transfer-displaced' | 'transfer-follow-full' | 'holiday-release-seat-taken' | 'slot-follow-full'

export type TemplatePendingOrigin = {
  kind: TemplatePendingOriginKind
  /** 室長向けの理由文（ツールチップ・確認の画面・保留の帯に出す）。 */
  note: string
}

export type TemplatePendingDesk = {
  lower: TemplatePendingLower
  /** 保留を作ったテンプレ保存の反映日（テンプレ保存以外が作った保留はその操作の対象日）。 */
  effectiveStartDate: string
  /** 保留を作った日時（ISO）。 */
  createdAt: string
  /** 保留を作った自動処理（任意・2026-10-25）。無ければテンプレ保存の保留。 */
  origin?: TemplatePendingOrigin
}

const PENDING_ORIGIN_KINDS = new Set<TemplatePendingOriginKind>(['whole-day-transfer-displaced', 'transfer-follow-full', 'holiday-release-seat-taken', 'slot-follow-full'])

/** 読込時の正規化: 種別が既知で理由文が文字列のときだけ受け付ける（形が壊れた値は捨てる＝従来のテンプレ保存の保留として扱う）。 */
export function normalizeTemplatePendingOrigin(value: unknown): TemplatePendingOrigin | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (typeof record.kind !== 'string' || !PENDING_ORIGIN_KINDS.has(record.kind as TemplatePendingOriginKind)) return undefined
  return { kind: record.kind as TemplatePendingOriginKind, note: typeof record.note === 'string' ? record.note : '' }
}

/** 保留の由来の短い見出し（ツールチップ・帯）。テンプレ保存の保留は従来の文のまま。 */
export function describeTemplatePendingOrigin(origin: TemplatePendingOrigin | undefined): string {
  if (!origin) return ''
  return origin.note
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
    ...(lower.teacher ? { teacher: { ...lower.teacher } } : {}),
  }
}

const LOWER_TEACHER_SOURCES = new Set(['manual', 'manual-replaced', 'schedule-registration', 'deleted'])

/** 読込時の正規化: 下段の講師は名前が空でない object だけ受け付ける（形が壊れた値は捨てる＝Q24-5 の「形が壊れた値だけ落とす」）。 */
export function normalizeTemplatePendingLowerTeacher(value: unknown): TemplatePendingLowerTeacher | undefined {
  if (!value || typeof value !== 'object') return undefined
  const record = value as Record<string, unknown>
  if (typeof record.teacher !== 'string' || !record.teacher.trim()) return undefined
  const source = typeof record.teacherAssignmentSource === 'string' && LOWER_TEACHER_SOURCES.has(record.teacherAssignmentSource) ? record.teacherAssignmentSource as TemplatePendingLowerTeacher['teacherAssignmentSource'] : undefined
  return {
    teacher: record.teacher,
    manualTeacher: typeof record.manualTeacher === 'boolean' ? record.manualTeacher : undefined,
    teacherAssignmentSource: source,
    teacherAssignmentSessionId: typeof record.teacherAssignmentSessionId === 'string' ? record.teacherAssignmentSessionId : undefined,
    teacherAssignmentTeacherId: typeof record.teacherAssignmentTeacherId === 'string' ? record.teacherAssignmentTeacherId : undefined,
  }
}

/** そのコマの保留の下段が持つ手置き講師の名前（Q41-5: 講習の講師自動割当・QR 自己修復が「そのコマに居る」と数える）。 */
export function collectTemplatePendingLowerTeacherNames(map: TemplatePendingDeskMap | null | undefined, cellId: string): string[] {
  if (!hasTemplatePendingDesks(map)) return []
  const names: string[] = []
  for (const [key, entry] of Object.entries(map)) {
    const parsed = parseTemplatePendingDeskKey(key)
    if (!parsed || parsed.cellId !== cellId) continue
    const name = entry.lower.teacher?.teacher.trim()
    if (name) names.push(name)
  }
  return names
}

export function cloneTemplatePendingDeskMap(map: TemplatePendingDeskMap | null | undefined): TemplatePendingDeskMap {
  if (!map) return {}
  const result: TemplatePendingDeskMap = {}
  for (const [key, entry] of Object.entries(map)) {
    result[key] = {
      lower: cloneTemplatePendingLower(entry.lower),
      effectiveStartDate: entry.effectiveStartDate,
      createdAt: entry.createdAt,
      ...(entry.origin ? { origin: { ...entry.origin } } : {}),
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
    const teacher = normalizeTemplatePendingLowerTeacher(lowerRecord.teacher)
    if (teacher) lower.teacher = teacher
    const origin = normalizeTemplatePendingOrigin(entry.origin)
    result[key] = {
      lower,
      effectiveStartDate: typeof entry.effectiveStartDate === 'string' ? entry.effectiveStartDate : '',
      createdAt: typeof entry.createdAt === 'string' ? entry.createdAt : '',
      ...(origin ? { origin } : {}),
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

// spec-template-behavior Q31（第 1 段 (C)）: 講師だけの机の詰め直し（repackTeacherOnlyDesks）・講習の講師自動割当
// （autoAssignTeacherToSpecialSession）・ユーザーの詰め替え／同席番並べ替え（packSortCellDesks / seatSortCells）が
// **動かさない・上書きしない・位置を固定する**机の ID（そのコマの保留の机）。保留マップのキーは机 ID なので、
// 講師や机の位置を動かすと下段が別の机・別の講師の下へずれる。保留が無いコマは undefined（＝従来どおり）。
// 呼び出し側は機能フラグ templateDiffApply が ON の教室だけ保留マップを渡す（OFF は null＝挙動不変）。
export function collectTemplatePendingDeskIdsInCell(map: TemplatePendingDeskMap | null | undefined, cellId: string): ReadonlySet<string> | undefined {
  if (!hasTemplatePendingDesks(map)) return undefined
  let ids: Set<string> | undefined
  for (const key of Object.keys(map)) {
    const parsed = parseTemplatePendingDeskKey(key)
    if (!parsed || parsed.cellId !== cellId) continue
    if (!ids) ids = new Set<string>()
    ids.add(parsed.deskId)
  }
  return ids
}

/** 生徒の同一性（INV-12 の「同じ生徒」）: 管理生徒 ID があればそれ、無ければ名前（templateTransferFollow の studentIdentity と同じ規則）。 */
export function templatePendingStudentIdentity(student: Pick<StudentEntry, 'managedStudentId' | 'name'>) {
  return student.managedStudentId ?? student.name
}

/** 下段に生きている生徒・記録・メモ・講師が 1 つも無い（キーを消してよい）。 */
export function isTemplatePendingLowerEmpty(lower: TemplatePendingLower) {
  return !lower.lesson?.studentSlots.some(Boolean) && !lower.statusSlots?.some(Boolean) && !lower.memoSlots?.some((memo) => memo != null && memo !== '') && !lower.teacher
}

/**
 * 保留（下段）へ 1 人置く（決定記録 48・2026-10-25・spec-template-behavior §H Q42 の**唯一の共通手順**。丸ごと振替の押し出し・Q40-2 の満席・休日解除の
 * 席ふさがりがいずれもこれを使う＝置き方を 3 か所に書かない）: 望みの机番号の下段の空いた席（望みの席 → もう一方）。埋まっていれば次の机の下段
 * （末尾まで行けば先頭へ）。全机の下段が埋まっていれば null（呼び出し側が従来の扱いへ）。入力の保留マップは変えない（純関数）。
 * 既にある保留（テンプレ保存の下段など）に相乗りするときは、その保留の由来（origin）・反映日・作成日時は上書きしない。
 * 置く中身は生徒（student）かメモ（memo）のどちらか 1 つ（2026-10-27 オーナー指示「メモも消えないようにして」・確認リスト tp-62:
 * 丸ごと振替の振替先の席のメモも同じ手順で下段へ残す。下段のメモは Q24 の既存の形＝lower.memoSlots。席の空き判定は生徒・記録・メモの共通）。
 */
export function placeIntoPendingLower(params: {
  cell: SlotCell
  pendingDesks: TemplatePendingDeskMap
  preferredDeskIndex: number
  preferredSeat: number
  effectiveStartDate: string
  createdAt: string
  kind: TemplatePendingOriginKind
  note: string
} & ({ student: StudentEntry; memo?: undefined } | { memo: string; student?: undefined })): { nextPendingDesks: TemplatePendingDeskMap; deskId: string; deskIndex: number; seatIndex: number } | null {
  const { cell } = params
  const lowerSeatTaken = (entry: TemplatePendingDesk | undefined, index: number) => Boolean(entry?.lower.lesson?.studentSlots[index]) || Boolean(entry?.lower.statusSlots?.[index]) || Boolean(entry?.lower.memoSlots?.[index])
  for (let offset = 0; offset < cell.desks.length; offset += 1) {
    const deskIndex = (params.preferredDeskIndex + offset) % cell.desks.length
    const desk = cell.desks[deskIndex]
    if (!desk) continue
    const key = buildTemplatePendingDeskKey(cell.id, desk.id)
    const existing = params.pendingDesks[key]
    const other = params.preferredSeat === 0 ? 1 : 0
    const seatIndex = !lowerSeatTaken(existing, params.preferredSeat) ? params.preferredSeat : (!lowerSeatTaken(existing, other) ? other : -1)
    if (seatIndex < 0) continue
    let lower: TemplatePendingLower
    if (params.student) {
      const slots: StudentPair = [existing?.lower.lesson?.studentSlots[0] ?? null, existing?.lower.lesson?.studentSlots[1] ?? null]
      slots[seatIndex] = params.student
      const lessonId = existing?.lower.lesson?.id ?? `pending_lower_${cell.dateKey}_${cell.slotNumber}_${deskIndex}`
      lower = existing
        ? { ...existing.lower, lesson: { ...(existing.lower.lesson ?? { id: lessonId }), studentSlots: slots } }
        : { lesson: { id: lessonId, studentSlots: slots } }
    } else {
      const memos: [string | null, string | null] = [existing?.lower.memoSlots?.[0] ?? null, existing?.lower.memoSlots?.[1] ?? null]
      memos[seatIndex] = params.memo
      lower = existing ? { ...existing.lower, memoSlots: memos } : { memoSlots: memos }
    }
    const entry: TemplatePendingDesk = existing
      ? { ...existing, lower }
      : { lower, effectiveStartDate: params.effectiveStartDate, createdAt: params.createdAt, origin: { kind: params.kind, note: params.note } }
    return { nextPendingDesks: { ...params.pendingDesks, [key]: entry }, deskId: desk.id, deskIndex, seatIndex }
  }
  return null
}
