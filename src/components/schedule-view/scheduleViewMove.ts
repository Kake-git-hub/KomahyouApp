// 日程表コマ組み(spec-student-schedule-dnd)の純関数群。
// 生徒日程表(ScheduleView)の授業カードD&D→机選択→盤面 executeMoveStudent 直呼びのうち、
// 「source の頑健な特定」「target の物理的な空き検証」「机選択モーダルの表示データ」を担う。
// 自動割振ルール・警告はここでは一切評価しない(2026-07-08 オーナー確定・物理的な空きのみ判定)。
import type { SlotCell, StudentEntry } from '../schedule-board/types'

// 移動元カード。entryId(盤面 studentSlots のエントリid)＋生徒id＋日付＋時限で特定する。
// 名前や科目だけで特定しない(同一生徒が同コマに2科目持つケースの取り違え防止・spec §D-2-2)。
export type ScheduleViewMoveSource = {
  entryId: string
  // linkedStudentId(名簿の生徒id)。エントリ側の managedStudentId と両方あるときは一致を要求する。
  studentId?: string
  sourceDateKey: string
  sourceSlotNumber: number
  lessonType: string
  subject: string
  studentName: string
}

export type ScheduleViewMoveSeat = {
  targetDateKey: string
  targetSlotNumber: number
  deskIndex: number
  studentIndex: number
  // 別タブ(生成HTML)の机選択モーダルが見せた机の同一性。盤面の生 weeks と日程表の overlay 済みセルは
  // 机の並び/本数が食い違うことがある(テンプレ由来の机・未ロード週)ため、positional な deskIndex だけに
  // 頼らず、まず deskId(=盤面 desk.id と一致)→ 講師名で実机を解決する(resolveScheduleViewTargetDeskIndex)。
  deskId?: string
  deskTeacher?: string
}

// 生徒日程表(別タブ・生成HTML)のD&D確定で popup が opener(本体)へ送る
// `schedule-student-move-request` の payload を検証して {source, seat} に変換する。
// 埋め込みJS(信頼境界の外)からの入力なので型を厳密に絞り、1つでも欠け/不正なら null(移動不成立)を返す。
// studentIndex は机の2席(0/1)のみ。deskIndex は非負。
export function parseScheduleViewMoveMessage(
  message: unknown,
): { source: ScheduleViewMoveSource; seat: ScheduleViewMoveSeat } | null {
  if (!message || typeof message !== 'object') return null
  const raw = message as Record<string, unknown>
  if (!raw.source || typeof raw.source !== 'object' || !raw.seat || typeof raw.seat !== 'object') return null
  const s = raw.source as Record<string, unknown>
  const t = raw.seat as Record<string, unknown>
  const asKey = (value: unknown): string | null => (typeof value === 'string' && value.length > 0 ? value : null)
  const asNum = (value: unknown): number | null => (typeof value === 'number' && Number.isFinite(value) ? value : null)

  const entryId = asKey(s.entryId)
  const sourceDateKey = asKey(s.sourceDateKey)
  const sourceSlotNumber = asNum(s.sourceSlotNumber)
  const lessonType = asKey(s.lessonType)
  const targetDateKey = asKey(t.targetDateKey)
  const targetSlotNumber = asNum(t.targetSlotNumber)
  const deskIndex = asNum(t.deskIndex)
  const studentIndex = asNum(t.studentIndex)

  if (entryId === null || sourceDateKey === null || sourceSlotNumber === null || lessonType === null) return null
  if (targetDateKey === null || targetSlotNumber === null || deskIndex === null || studentIndex === null) return null
  if (deskIndex < 0 || (studentIndex !== 0 && studentIndex !== 1)) return null

  const studentId = typeof s.studentId === 'string' && s.studentId.length > 0 ? s.studentId : undefined
  return {
    source: {
      entryId,
      studentId,
      sourceDateKey,
      sourceSlotNumber,
      lessonType,
      subject: typeof s.subject === 'string' ? s.subject : '',
      studentName: typeof s.studentName === 'string' ? s.studentName : '',
    },
    seat: {
      targetDateKey,
      targetSlotNumber,
      deskIndex,
      studentIndex,
      deskId: typeof t.deskId === 'string' && t.deskId.length > 0 ? t.deskId : undefined,
      deskTeacher: typeof t.deskTeacher === 'string' ? t.deskTeacher : undefined,
    },
  }
}

export type ScheduleViewMoveSourceHit = {
  cellId: string
  deskIndex: number
  studentIndex: number
  student: StudentEntry
}

// 盤面 weeks から移動元エントリを特定する。見つからない・生徒id不一致なら null(移動不成立)。
export function findScheduleViewMoveSource(weeks: SlotCell[][], source: ScheduleViewMoveSource): ScheduleViewMoveSourceHit | null {
  for (const week of weeks) {
    for (const cell of week) {
      if (cell.dateKey !== source.sourceDateKey || cell.slotNumber !== source.sourceSlotNumber) continue
      for (let deskIndex = 0; deskIndex < cell.desks.length; deskIndex++) {
        const desk = cell.desks[deskIndex]
        if (!desk.lesson) continue
        for (let studentIndex = 0; studentIndex < desk.lesson.studentSlots.length; studentIndex++) {
          const student = desk.lesson.studentSlots[studentIndex]
          if (!student || student.id !== source.entryId) continue
          if (source.studentId && student.managedStudentId && student.managedStudentId !== source.studentId) return null
          return { cellId: cell.id, deskIndex, studentIndex, student }
        }
      }
      return null
    }
  }
  return null
}

// 表示期間内の対象コマを weeks から探す(週の自動拡張は呼び出し側で ensureWeeksCoverDateRange 済み)。
export function findScheduleViewTargetCell(weeks: SlotCell[][], dateKey: string, slotNumber: number): { weekIndex: number; cell: SlotCell } | null {
  for (let weekIndex = 0; weekIndex < weeks.length; weekIndex++) {
    const cell = weeks[weekIndex].find((candidate) => candidate.dateKey === dateKey && candidate.slotNumber === slotNumber)
    if (cell) return { weekIndex, cell }
  }
  return null
}

export type ScheduleViewMoveValidation = { ok: true } | { ok: false; reason: string }

// 移動先の物理的な空きのみ検証する(満席・休校日・机なし・メモ席)。
// 自動割振ルール・警告は評価しない(spec §B-4)。詳細ブロック(出席済み・同コマ重複など)は
// computeStudentMove 側の既存判定に委ねる。
export function validateScheduleViewMoveTarget(cell: SlotCell | null | undefined, deskIndex: number, studentIndex: number): ScheduleViewMoveValidation {
  if (!cell) return { ok: false, reason: '移動先のコマが見つかりませんでした。' }
  if (!cell.isOpenDay) return { ok: false, reason: '移動先は休校日のため移動できません。' }
  const desk = cell.desks[deskIndex]
  if (!desk) return { ok: false, reason: '移動先の机が見つかりませんでした。' }
  if (desk.lesson?.studentSlots[studentIndex]) return { ok: false, reason: '移動先の席にはすでに生徒がいます。' }
  if (desk.memoSlots?.[studentIndex]) return { ok: false, reason: 'メモがある席には配置できません。メモを削除してから配置してください。' }
  return { ok: true }
}

export type DeskPickerSeat = {
  studentIndex: number
  occupied: boolean
  // 着席中の生徒表示(名前+科目)。空席は ''。
  label: string
  // 出欠ステータス(休みなど)の补足。物理的には空席だが記録がある席に表示する。
  statusLabel: string
  blockedByMemo: boolean
  selectable: boolean
}

export type DeskPickerDesk = {
  deskIndex: number
  // 盤面 desk.id。移動確定時に positional index ではなく机同一性で解決するために持たせる。
  deskId: string
  teacher: string
  seats: DeskPickerSeat[]
}

// 机選択モーダル(コマ表のコマと同じ配置)の表示データ。
export function buildDeskPickerDesks(cell: SlotCell, resolveDisplayName?: (name: string) => string): DeskPickerDesk[] {
  const displayName = (name: string) => (resolveDisplayName ? resolveDisplayName(name) : name)
  return cell.desks.map((desk, deskIndex) => ({
    deskIndex,
    deskId: desk.id,
    teacher: desk.teacher,
    seats: [0, 1].map((studentIndex) => {
      const student = desk.lesson?.studentSlots[studentIndex] ?? null
      const status = desk.statusSlots?.[studentIndex] ?? null
      const blockedByMemo = !student && Boolean(desk.memoSlots?.[studentIndex])
      const statusLabel = !student && status && status.status !== 'moved'
        ? `${status.status === 'attended' ? '出席' : status.status === 'absent-no-makeup' ? '振無休' : '休'} ${displayName(status.name)}`
        : ''
      return {
        studentIndex,
        occupied: Boolean(student),
        label: student ? `${displayName(student.name)} ${student.subject}` : '',
        statusLabel,
        blockedByMemo,
        selectable: !student && !blockedByMemo,
      }
    }),
  }))
}

// 別タブ(生成HTML)の机選択で「机選択モーダルが見せた机」を、盤面の対象セルの実机に解決して index を返す。
// 日程表(overlay 済みセル)と盤面の生 weeks は机の並び/本数が食い違うことがあるため、positional な
// deskIndex に頼らず机同一性で解決する。優先順:
//   1) deskId 一致(=盤面 desk.id)かつ対象席が空き
//   2) positional deskIndex の机の講師が一致し対象席が空き(deskId 未指定時の後方互換)
//   3) 講師名一致の机で対象席が空き
//   4) 講師名指定なし: 空席のある任意の机
// どれも満たさなければ元の deskIndex を返す(呼び出し側の validate が最終的に弾く)。
export function resolveScheduleViewTargetDeskIndex(cell: SlotCell, seat: ScheduleViewMoveSeat): number {
  const seatEmpty = (desk: SlotCell['desks'][number]) =>
    !desk.lesson?.studentSlots[seat.studentIndex] && !desk.memoSlots?.[seat.studentIndex]

  if (seat.deskId) {
    const byId = cell.desks.findIndex((desk) => desk.id === seat.deskId && seatEmpty(desk))
    if (byId >= 0) return byId
  }

  const positional = cell.desks[seat.deskIndex]
  if (positional && seatEmpty(positional) && (seat.deskTeacher === undefined || positional.teacher === seat.deskTeacher)) {
    return seat.deskIndex
  }

  if (seat.deskTeacher !== undefined && seat.deskTeacher !== '') {
    const byTeacher = cell.desks.findIndex((desk) => desk.teacher === seat.deskTeacher && seatEmpty(desk))
    if (byTeacher >= 0) return byTeacher
  } else if (seat.deskTeacher === '') {
    const byEmptyTeacher = cell.desks.findIndex((desk) => desk.teacher === '' && seatEmpty(desk))
    if (byEmptyTeacher >= 0) return byEmptyTeacher
  }

  return seat.deskIndex
}
