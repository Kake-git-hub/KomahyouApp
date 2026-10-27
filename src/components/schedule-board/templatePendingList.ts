// 保留（2 行・緑）の机の週をまたいだ一覧（決定記録 48 §3・docs/plan-2026-10-25-conflict-placement.md §3「件数と一覧」・
// docs/spec-template-behavior.md §H Q42-6）。盤面上部の「保留 n」バッジを押すと開く一覧の行を作る。
//
// ★件数（countTemplatePendingDesksOnBoard）と同じ規則で数える＝バッジの n と一覧の行数を必ず揃える
//   （盤面に無い孤児キー・その机が無いキー・反映日より前のセルは出さない）。
// ★読むだけ。保留マップ・週データは変えない（解決は既存の保留の机メニュー＝computePendingDeskResolution に任せる）。
// ★下段は盤面画面専用（INV-13）。この一覧も盤面画面の中だけで使い、PDF・共有画面・日程表には出さない。
//
// このファイルは純データ・純関数のみ（DOM / ネットワークに触らない）。

import type { SlotCell, StudentEntry, StudentStatusEntry } from './types'
import { hasTemplatePendingDesks, parseTemplatePendingDeskKey, type TemplatePendingDeskMap, type TemplatePendingOriginKind } from './templatePendingDesks'

export type TemplatePendingListRow = {
  key: string
  cellId: string
  deskId: string
  /** そのコマの机の並び順（0 始まり）。「このコマへ」で机を選ぶのに使う。 */
  deskIndex: number
  dateKey: string
  dateLabel: string
  dayLabel: string
  slotLabel: string
  slotNumber: number
  /** 下段（保留に残した側）の中身。生徒は「名前（科目）」、手置き講師は「講師 名前」、記録だけの席は「名前（記録）」、メモは「メモ:内容」。 */
  lowerLabels: string[]
  /** 上段（今その机に居る側）の生徒。 */
  upperLabels: string[]
  /** 由来の短い見出し（テンプレ保存・丸ごと振替 など）。 */
  kindLabel: string
  /** 理由文（保留の origin.note。テンプレ保存の保留は既定の文）。 */
  reason: string
}

const ORIGIN_KIND_LABELS: Record<TemplatePendingOriginKind, string> = {
  'whole-day-transfer-displaced': '丸ごと振替',
  'transfer-follow-full': '振替先が満席',
  'holiday-release-seat-taken': '休日解除',
  'slot-follow-full': '時限変更の追従',
}

export const TEMPLATE_SAVE_PENDING_KIND_LABEL = 'テンプレ保存'
export const TEMPLATE_SAVE_PENDING_REASON = 'テンプレ保存で、手入力の授業とテンプレの授業が同じ席にぶつかったため、手入力の授業を保留(下段)に残しました。「テンプレを採用」「既存を採用」か、下段の生徒を動かして片づけてください。'

/**
 * 講師の保留（Q41・手置き講師×テンプレの別の講師）の理由文（tp-64・オーナー確定 2026-10-27「講師と生徒を別々に採用」）。
 * 講師だけが残った机（生徒の側は片づき済み）も一覧に出るので、何を選べば片づくかを書く。
 */
export function describeTemplatePendingTeacherReason(templateTeacher: string, manualTeacher: string) {
  return `テンプレの講師（${templateTeacher || 'なし'}）と手で置いた講師（${manualTeacher}）がこの机で重なっています。緑の下の行の講師を押して、どちらの講師にするか選んでください。`
}

const STATUS_LABELS: Record<StudentStatusEntry['status'], string> = {
  absent: '欠席',
  'absent-no-makeup': '振無休',
  attended: '出席',
  moved: '休',
  holiday: '休日',
}

function studentLabel(student: Pick<StudentEntry, 'name' | 'subject'>) {
  return student.subject ? `${student.name}（${student.subject}）` : student.name
}

/**
 * 盤面の週データと保留マップから、保留の机の一覧を作る（日付 → 時限 → 机の順）。
 * 行数は countTemplatePendingDesksOnBoard と同じ（同じ除外規則）。
 */
export function buildTemplatePendingList(map: TemplatePendingDeskMap | null | undefined, weeks: readonly SlotCell[][]): TemplatePendingListRow[] {
  if (!hasTemplatePendingDesks(map)) return []
  const cellById = new Map<string, SlotCell>()
  for (const week of weeks) for (const cell of week) cellById.set(cell.id, cell)
  const rows: TemplatePendingListRow[] = []
  for (const [key, entry] of Object.entries(map)) {
    const parsed = parseTemplatePendingDeskKey(key)
    if (!parsed) continue
    const cell = cellById.get(parsed.cellId)
    if (!cell) continue
    const deskIndex = cell.desks.findIndex((desk) => desk.id === parsed.deskId)
    if (deskIndex < 0) continue
    if (entry.effectiveStartDate && cell.dateKey < entry.effectiveStartDate) continue
    const desk = cell.desks[deskIndex]
    const lower = entry.lower
    const lowerLabels: string[] = []
    const lowerStudents = lower.lesson?.studentSlots ?? [null, null]
    for (let seat = 0; seat < 2; seat += 1) {
      const student = lowerStudents[seat]
      if (student) {
        lowerLabels.push(studentLabel(student))
        continue
      }
      const status = lower.statusSlots?.[seat]
      if (status) lowerLabels.push(`${status.name}（${STATUS_LABELS[status.status] ?? '記録'}）`)
      // 下段のメモ（テンプレ保存の Q24 と、2026-10-27 からの丸ごと振替の振替先のメモ）。メモだけの席も一覧で中身が分かるようにする。
      const memo = lower.memoSlots?.[seat]
      if (typeof memo === 'string' && memo.trim() !== '') lowerLabels.push(`メモ:${memo.replace(/\s+/g, ' ').trim()}`)
    }
    if (lower.teacher?.teacher) lowerLabels.push(`講師 ${lower.teacher.teacher}`)
    const upperSlots: ReadonlyArray<StudentEntry | null> = desk.lesson?.studentSlots ?? []
    const upperLabels = upperSlots.filter((student): student is StudentEntry => Boolean(student)).map(studentLabel)
    // tp-64: 講師の保留は上の行の講師も並べ、理由文に講師の選び方を足す（講師だけが残った机は講師の理由だけ）。
    if (lower.teacher?.teacher && desk.teacher.trim()) upperLabels.push(`講師 ${desk.teacher.trim()}`)
    const teacherOnly = Boolean(lower.teacher?.teacher) && lowerLabels.length === 1 && !(lower.memoSlots ?? []).some((memo) => typeof memo === 'string' && memo.trim() !== '')
    const baseReason = entry.origin?.note || TEMPLATE_SAVE_PENDING_REASON
    const teacherReason = lower.teacher?.teacher ? describeTemplatePendingTeacherReason(desk.teacher.trim(), lower.teacher.teacher) : ''
    rows.push({
      key,
      cellId: cell.id,
      deskId: parsed.deskId,
      deskIndex,
      dateKey: cell.dateKey,
      dateLabel: cell.dateLabel,
      dayLabel: cell.dayLabel,
      slotLabel: cell.slotLabel,
      slotNumber: cell.slotNumber,
      lowerLabels,
      upperLabels,
      kindLabel: entry.origin ? ORIGIN_KIND_LABELS[entry.origin.kind] : TEMPLATE_SAVE_PENDING_KIND_LABEL,
      reason: teacherOnly ? teacherReason : [baseReason, teacherReason].filter(Boolean).join(''),
    })
  }
  rows.sort((left, right) => (
    left.dateKey.localeCompare(right.dateKey)
    || left.slotNumber - right.slotNumber
    || left.deskIndex - right.deskIndex
  ))
  return rows
}
