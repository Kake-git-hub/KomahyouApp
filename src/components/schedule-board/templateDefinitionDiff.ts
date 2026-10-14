// テンプレ保存で「テンプレで変えたコマ（曜日×時限）だけ突き合わせる」ための純関数（spec-template-behavior §H Q39・オーナー案 2026-10-14・Issue #75）。
//
// 背景: 差分反映（Q21〜Q38）は反映日以降の**全コマ**を机ごとに突き合わせるため、テンプレが盤面の実態より古い教室（緑が丘校は #72 以降、
// 先の週を手で直してきた）では、2 机しか変えていない保存でも全コマで講師の揃え・保留（緑）が出る。室長の頭の中は「対象 1 コマだけ変えるテンプレ」
// なので、**前回保存したテンプレと中身が違うコマだけ**を突き合わせ、違わないコマは一切触らない（＝保存しなかったのと同じ）。
//
// このファイルは純関数だけ（DOM・日付の現在時刻に触らない。今日は引数で受ける）。差分反映の本体 `templateDiffApply.ts` が
// `isCellInTemplateDiffScope` を 1 行で呼び、確認モーダルは `diffTemplateDefinitions` の結果（変更点一覧）を出す。

import type { RegularLessonTemplate, RegularLessonTemplateDesk, RegularLessonTemplateStudent } from '../regular-template/regularLessonTemplate'
import { regularTemplateDayOptions } from '../regular-template/regularLessonTemplate'

export const TEMPLATE_DAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const

/** コマ（曜日×時限）の鍵。差分反映のセル（日付×時限）は曜日に直してから引く。 */
export function buildTemplateSlotKey(dayOfWeek: number, slotNumber: number) {
  return `${dayOfWeek}__${slotNumber}`
}

export function parseTemplateSlotKey(key: string): { dayOfWeek: number; slotNumber: number } | null {
  const [day, slot] = key.split('__')
  const dayOfWeek = Number(day)
  const slotNumber = Number(slot)
  if (!Number.isInteger(dayOfWeek) || !Number.isInteger(slotNumber)) return null
  return { dayOfWeek, slotNumber }
}

/** `YYYY-MM-DD`（ローカル日付）の曜日。盤面のセルは dateKey しか持たないので、ここで曜日に直す。 */
export function resolveDayOfWeekFromDateKey(dateKey: string) {
  const [year, month, day] = dateKey.split('-').map(Number)
  return new Date(year, (month || 1) - 1, day || 1).getDay()
}

export function buildTemplateSlotKeyForDate(dateKey: string, slotNumber: number) {
  return buildTemplateSlotKey(resolveDayOfWeekFromDateKey(dateKey), slotNumber)
}

export function formatTemplateSlotLabel(dayOfWeek: number, slotNumber: number) {
  return `${TEMPLATE_DAY_LABELS[dayOfWeek] ?? '?'} ${slotNumber}限`
}

// ─────────────────────────────────────────────────────────────────────────────
// テンプレ同士の差（前回保存したテンプレ ↔ 今から保存するテンプレ）
// ─────────────────────────────────────────────────────────────────────────────

export type TemplateDefinitionSeatDiff = {
  seat: 0 | 1
  before: RegularLessonTemplateStudent | null
  after: RegularLessonTemplateStudent | null
  changed: boolean
}

export type TemplateDefinitionDeskDiff = {
  dayOfWeek: number
  slotNumber: number
  deskIndex: number
  teacherBefore: string
  teacherAfter: string
  teacherChanged: boolean
  seats: [TemplateDefinitionSeatDiff, TemplateDefinitionSeatDiff]
}

/** 全コマを突き合わせる理由。`no-previous`＝比べる前回テンプレが無い（年度初回など）、`desk-count`＝机の数が違う（机番号がずれる）。 */
export type TemplateDefinitionDiffReason = 'no-previous' | 'desk-count'

export type TemplateDefinitionDiff = {
  /** true なら全コマが変わった扱い（changedSlotKeys は空）。 */
  allSlots: boolean
  reason?: TemplateDefinitionDiffReason
  /** 中身が違うコマの鍵（月→日・時限の順）。 */
  changedSlotKeys: string[]
  /** 中身が違う机（講師か席のどれかが違う）。変更点一覧に出す。 */
  changedDesks: TemplateDefinitionDeskDiff[]
}

function normalizeStudent(student: RegularLessonTemplateStudent | null | undefined): RegularLessonTemplateStudent | null {
  if (!student || !student.studentId) return null
  return { studentId: student.studentId, subject: student.subject, ...(student.note ? { note: student.note } : {}) }
}

function isSameTemplateStudent(a: RegularLessonTemplateStudent | null, b: RegularLessonTemplateStudent | null) {
  if (!a && !b) return true
  if (!a || !b) return false
  return a.studentId === b.studentId && a.subject === b.subject && (a.note ?? '') === (b.note ?? '')
}

function resolveTemplateDeskCount(template: RegularLessonTemplate) {
  return template.cells.reduce((max, cell) => Math.max(max, cell.desks.length), 0)
}

function emptyDesk(deskIndex: number): RegularLessonTemplateDesk {
  return { deskIndex, teacherId: '', students: [null, null] }
}

function slotOrder(dayOfWeek: number, slotNumber: number) {
  const dayIndex = (regularTemplateDayOptions as readonly number[]).indexOf(dayOfWeek)
  return (dayIndex < 0 ? 99 : dayIndex) * 100 + slotNumber
}

/**
 * 前回のテンプレと今回のテンプレを曜日×時限×机ごとに比べ、中身が違うコマと机を返す（純関数）。
 * - 比べるのは講師 ID・生徒 1・科目 1・生徒 2・科目 2（と備考）。机の並び（deskIndex）どうし。
 * - 前回が無い → 全コマ（`no-previous`）。机の数が違う → 全コマ（`desk-count`。机番号がずれるため）。
 * - どちらかに無いコマ・机は「空」として比べる（正規化済みのテンプレは 7 曜日 × 5 時限 × 机数を必ず持つが、旧データに備える）。
 */
export function diffTemplateDefinitions(previous: RegularLessonTemplate | null | undefined, next: RegularLessonTemplate): TemplateDefinitionDiff {
  if (!previous) return { allSlots: true, reason: 'no-previous', changedSlotKeys: [], changedDesks: [] }
  const previousDeskCount = resolveTemplateDeskCount(previous)
  const nextDeskCount = resolveTemplateDeskCount(next)
  if (previousDeskCount > 0 && nextDeskCount > 0 && previousDeskCount !== nextDeskCount) {
    return { allSlots: true, reason: 'desk-count', changedSlotKeys: [], changedDesks: [] }
  }
  const previousBySlot = new Map(previous.cells.map((cell) => [buildTemplateSlotKey(cell.dayOfWeek, cell.slotNumber), cell]))
  const nextBySlot = new Map(next.cells.map((cell) => [buildTemplateSlotKey(cell.dayOfWeek, cell.slotNumber), cell]))
  const slotKeys = [...new Set([...previousBySlot.keys(), ...nextBySlot.keys()])]
    .map((key) => ({ key, parsed: parseTemplateSlotKey(key) }))
    .filter((item): item is { key: string; parsed: { dayOfWeek: number; slotNumber: number } } => item.parsed !== null)
    .sort((a, b) => slotOrder(a.parsed.dayOfWeek, a.parsed.slotNumber) - slotOrder(b.parsed.dayOfWeek, b.parsed.slotNumber))

  const changedSlotKeys: string[] = []
  const changedDesks: TemplateDefinitionDeskDiff[] = []
  for (const { key, parsed } of slotKeys) {
    const previousDesks = new Map((previousBySlot.get(key)?.desks ?? []).map((desk) => [desk.deskIndex, desk]))
    const nextDesks = new Map((nextBySlot.get(key)?.desks ?? []).map((desk) => [desk.deskIndex, desk]))
    const deskIndexes = [...new Set([...previousDesks.keys(), ...nextDesks.keys()])].sort((a, b) => a - b)
    let slotChanged = false
    for (const deskIndex of deskIndexes) {
      const before = previousDesks.get(deskIndex) ?? emptyDesk(deskIndex)
      const after = nextDesks.get(deskIndex) ?? emptyDesk(deskIndex)
      const teacherBefore = before.teacherId ?? ''
      const teacherAfter = after.teacherId ?? ''
      const seats = ([0, 1] as const).map((seat) => {
        const seatBefore = normalizeStudent(before.students?.[seat])
        const seatAfter = normalizeStudent(after.students?.[seat])
        return { seat, before: seatBefore, after: seatAfter, changed: !isSameTemplateStudent(seatBefore, seatAfter) }
      }) as [TemplateDefinitionSeatDiff, TemplateDefinitionSeatDiff]
      const teacherChanged = teacherBefore !== teacherAfter
      if (!teacherChanged && !seats[0].changed && !seats[1].changed) continue
      slotChanged = true
      changedDesks.push({ dayOfWeek: parsed.dayOfWeek, slotNumber: parsed.slotNumber, deskIndex, teacherBefore, teacherAfter, teacherChanged, seats })
    }
    if (slotChanged) changedSlotKeys.push(key)
  }
  return { allSlots: false, changedSlotKeys, changedDesks }
}

export type TemplateDefinitionNameResolvers = {
  studentName: (studentId: string) => string
  teacherName: (teacherId: string) => string
}

function formatSeat(student: RegularLessonTemplateStudent | null, resolvers: TemplateDefinitionNameResolvers) {
  if (!student) return 'なし'
  return `${resolvers.studentName(student.studentId) || student.studentId}（${student.subject}）`
}

/** 変更点 1 机ぶんの文（例「月 5限 机 3: 生徒1 ○○（数）→ なし」「水 2限 机 1: 講師 田中 → 鈴木／生徒2 なし → ○○（英）」）。 */
export function formatTemplateDefinitionDeskDiff(desk: TemplateDefinitionDeskDiff, resolvers: TemplateDefinitionNameResolvers) {
  const parts: string[] = []
  if (desk.teacherChanged) {
    const before = desk.teacherBefore ? (resolvers.teacherName(desk.teacherBefore) || desk.teacherBefore) : 'なし'
    const after = desk.teacherAfter ? (resolvers.teacherName(desk.teacherAfter) || desk.teacherAfter) : 'なし'
    parts.push(`講師 ${before} → ${after}`)
  }
  for (const seat of desk.seats) {
    if (!seat.changed) continue
    parts.push(`生徒${seat.seat + 1} ${formatSeat(seat.before, resolvers)} → ${formatSeat(seat.after, resolvers)}`)
  }
  return `${formatTemplateSlotLabel(desk.dayOfWeek, desk.slotNumber)} 机 ${desk.deskIndex}: ${parts.join('／')}`
}

/** 変更点一覧（確認モーダル用）。多すぎるときは limit 行で切り「…他 n 机」を足す。 */
export function buildTemplateDefinitionDiffLines(diff: TemplateDefinitionDiff, resolvers: TemplateDefinitionNameResolvers, limit = 40): string[] {
  const lines = diff.changedDesks.slice(0, limit).map((desk) => formatTemplateDefinitionDeskDiff(desk, resolvers))
  if (diff.changedDesks.length > limit) lines.push(`…他 ${diff.changedDesks.length - limit} 机`)
  return lines
}

export function formatTemplateSlotKeys(slotKeys: readonly string[]) {
  return slotKeys
    .map(parseTemplateSlotKey)
    .filter((parsed): parsed is { dayOfWeek: number; slotNumber: number } => parsed !== null)
    .map((parsed) => formatTemplateSlotLabel(parsed.dayOfWeek, parsed.slotNumber))
}

// ─────────────────────────────────────────────────────────────────────────────
// 差分反映に渡す絞り込み（Q39）
// ─────────────────────────────────────────────────────────────────────────────

export type TemplateDiffApplyScope = 'changed-slots' | 'all'

export type TemplateDiffSlotFilter = {
  /** 突き合わせるコマ（`buildTemplateSlotKey`）。 */
  slotKeys: ReadonlySet<string>
  /**
   * この日付より前の日は全コマ突き合わせる。反映日を前回のテンプレの反映日より**前**にしたとき、その期間は前回テンプレが効いていないので
   * 「変えたコマ」の判定が意味を持たない（Q39-2）。
   */
  fullBeforeDate?: string
}

/** 差分反映の本体が 1 セルごとに呼ぶ。filter が無ければ従来どおり全コマ。 */
export function isCellInTemplateDiffScope(cell: { dateKey: string; slotNumber: number }, filter: TemplateDiffSlotFilter | null | undefined) {
  if (!filter) return true
  if (filter.fullBeforeDate && cell.dateKey < filter.fullBeforeDate) return true
  return filter.slotKeys.has(buildTemplateSlotKeyForDate(cell.dateKey, cell.slotNumber))
}

/** 既定の範囲: 変えたコマが 1 つ以上あれば「変えたコマだけ」、0 件・比べる前回が無い・机の数が違うなら「すべて」（Q39-3）。 */
export function resolveDefaultTemplateDiffApplyScope(diff: TemplateDefinitionDiff): TemplateDiffApplyScope {
  return !diff.allSlots && diff.changedSlotKeys.length > 0 ? 'changed-slots' : 'all'
}

/** 確認文の試し実行と保存本体の両方に**同じ**絞り込みを渡す（Q32-1 の流儀）。`undefined` ＝ 全コマ。 */
export function resolveTemplateDiffSlotFilter(params: {
  diff: TemplateDefinitionDiff
  scope: TemplateDiffApplyScope
  previousEffectiveStartDate?: string | null
}): TemplateDiffSlotFilter | undefined {
  if (params.scope !== 'changed-slots') return undefined
  if (params.diff.allSlots || params.diff.changedSlotKeys.length === 0) return undefined
  return {
    slotKeys: new Set(params.diff.changedSlotKeys),
    ...(params.previousEffectiveStartDate ? { fullBeforeDate: params.previousEffectiveStartDate } : {}),
  }
}

export type TemplateDiffScopeNote =
  | { scope: 'changed-slots'; slotLabels: string[] }
  | { scope: 'all'; reason: 'no-change' | TemplateDefinitionDiffReason | 'user' }

/** 確認文・保存後メッセージに出す「どの範囲を突き合わせるか」。 */
export function describeTemplateDiffScope(diff: TemplateDefinitionDiff, scope: TemplateDiffApplyScope): TemplateDiffScopeNote {
  if (diff.allSlots) return { scope: 'all', reason: diff.reason ?? 'no-previous' }
  if (diff.changedSlotKeys.length === 0) return { scope: 'all', reason: 'no-change' }
  if (scope === 'all') return { scope: 'all', reason: 'user' }
  return { scope: 'changed-slots', slotLabels: formatTemplateSlotKeys(diff.changedSlotKeys) }
}

// ─────────────────────────────────────────────────────────────────────────────
// 反映開始日の既定（来週の月曜）と過去日の判定（Q39-5）
// ─────────────────────────────────────────────────────────────────────────────

function formatDateKey(date: Date) {
  return `${date.getFullYear()}-${`${date.getMonth() + 1}`.padStart(2, '0')}-${`${date.getDate()}`.padStart(2, '0')}`
}

/** 今日より後の最初の月曜（今日が月曜なら来週の月曜）。 */
export function resolveNextMondayDateKey(todayKey: string) {
  const [year, month, day] = todayKey.split('-').map(Number)
  const date = new Date(year, (month || 1) - 1, day || 1)
  const daysAhead = ((8 - date.getDay()) % 7) || 7
  date.setDate(date.getDate() + daysAhead)
  return formatDateKey(date)
}

/**
 * テンプレ編集を開いたときの反映開始日の既定（差分反映の教室）。
 * 来週の月曜。ただし保存済みテンプレの反映日がそれより先（まだ効いていないテンプレを直している）なら、その反映日を据え置く
 * （手前に動かすと、前回の反映日より前の期間が全コマ突き合わせになる・Q39-2）。
 */
export function resolveDefaultTemplateEffectiveStartDate(params: { todayKey: string; savedEffectiveStartDate?: string | null }) {
  const nextMonday = resolveNextMondayDateKey(params.todayKey)
  const saved = params.savedEffectiveStartDate ?? ''
  return saved > nextMonday ? saved : nextMonday
}

export function isTemplateEffectiveStartDateInPast(effectiveStartDate: string, todayKey: string) {
  return Boolean(effectiveStartDate) && effectiveStartDate < todayKey
}
