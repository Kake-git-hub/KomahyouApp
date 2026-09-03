import type { LessonType, SlotCell, StudentEntry, StudentStatusEntry } from './types'

export type LinkedLessonDestination = {
  dateKey: string
  slotNumber: number
}

type LinkedStockKind = 'makeup' | 'special'

function parseOriginSlotNumber(makeupSourceLabel?: string) {
  const matched = String(makeupSourceLabel ?? '').match(/(\d+)限/)
  return matched ? Number(matched[1]) : null
}

function formatLinkKey(params: {
  stockKind: LinkedStockKind
  studentKey: string
  subject: string
  dateKey: string
  slotNumber: number | null
}) {
  const { stockKind, studentKey, subject, dateKey, slotNumber } = params
  return [stockKind, studentKey, subject, dateKey, String(slotNumber ?? '')].join('__')
}

function resolveComparableStudentKeys(entry: Pick<StudentEntry | StudentStatusEntry, 'managedStudentId' | 'name'>) {
  const keys: string[] = []
  if (entry.managedStudentId) keys.push(entry.managedStudentId)
  if (entry.name) keys.push(`name:${entry.name}`)
  return keys
}

type LessonLinkStudentEntry = Pick<StudentEntry, 'managedStudentId' | 'name' | 'makeupSourceDate' | 'makeupSourceLabel' | 'lessonType' | 'subject'>
type LessonLinkStatusEntry = Pick<StudentStatusEntry, 'id' | 'managedStudentId' | 'name' | 'makeupSourceDate' | 'makeupSourceLabel' | 'lessonType' | 'subject' | 'status'>
type LessonLinkSlotCell = Pick<SlotCell, 'dateKey' | 'slotNumber'> & {
  desks: Array<{
    lesson?: { studentSlots: Array<LessonLinkStudentEntry | null> }
    statusSlots?: Array<LessonLinkStatusEntry | null>
  }>
}

function resolveStatusLinkKeys(statusEntry: LessonLinkStatusEntry, cell: LessonLinkSlotCell) {
  if (statusEntry.status !== 'absent') return []
  if (statusEntry.makeupSourceDate && statusEntry.makeupSourceDate !== cell.dateKey) return []

  const stockKind: LinkedStockKind = statusEntry.lessonType === 'special' ? 'special' : 'makeup'
  const subject = statusEntry.subject
  const dateKey = statusEntry.makeupSourceDate ?? cell.dateKey
  const slotNumber = parseOriginSlotNumber(statusEntry.makeupSourceLabel) ?? cell.slotNumber
  const slotCandidates: Array<number | null> = [slotNumber, null]

  const keys: string[] = []
  for (const studentKey of resolveComparableStudentKeys(statusEntry)) {
    for (const slot of slotCandidates) {
      keys.push(formatLinkKey({ stockKind, studentKey, subject, dateKey, slotNumber: slot }))
    }
  }
  return keys
}

function resolvePlacedLessonLinkKeys(student: LessonLinkStudentEntry, cell: LessonLinkSlotCell) {
  if (!student.makeupSourceDate) return []

  const stockKind: LinkedStockKind | null = student.lessonType === 'special'
    ? 'special'
    : student.lessonType === 'makeup' || student.lessonType === 'regular'
      ? 'makeup'
      : null

  if (!stockKind) return []
  if (student.makeupSourceDate === cell.dateKey) return []

  const subject = student.subject
  const dateKey = student.makeupSourceDate
  const slotNumber = parseOriginSlotNumber(student.makeupSourceLabel)
  const slotCandidates: Array<number | null> = slotNumber === null ? [null] : [slotNumber, null]

  const keys: string[] = []
  for (const studentKey of resolveComparableStudentKeys(student)) {
    for (const slot of slotCandidates) {
      keys.push(formatLinkKey({ stockKind, studentKey, subject, dateKey, slotNumber: slot }))
    }
  }
  return keys
}

export function buildLinkedLessonDestinationMap(cells: LessonLinkSlotCell[]) {
  const sortedCells = [...cells].sort((left, right) => {
    if (left.dateKey !== right.dateKey) return left.dateKey.localeCompare(right.dateKey)
    return left.slotNumber - right.slotNumber
  })
  const destinationByLinkKey = new Map<string, LinkedLessonDestination>()
  const registerDestination = (entry: LessonLinkStudentEntry, cell: LessonLinkSlotCell) => {
    for (const linkKey of resolvePlacedLessonLinkKeys(entry, cell)) {
      if (destinationByLinkKey.has(linkKey)) continue
      destinationByLinkKey.set(linkKey, { dateKey: cell.dateKey, slotNumber: cell.slotNumber })
    }
  }

  for (const cell of sortedCells) {
    for (const desk of cell.desks) {
      for (const student of desk.lesson?.studentSlots ?? []) {
        if (!student) continue
        registerDestination(student, cell)
      }
      // 回帰防止(緑が丘 室長報告 2026-09-04): 振替コマを「出席」「振無休」にすると studentSlots → statusSlots へ
      // 移る。配置(studentSlots)だけを振替先とみなすと、出席にした瞬間に元コマの「休」の振替先日付が消えていた。
      // 在庫会計(makeupStock.ts collectMakeupUsageByKey)はこれらを消化として数えるので、表示も同じ扱いにする。
      // ★absent(振替コマ自体を休みにした＝在庫へ戻った)と moved(会計は移動先が持つ・移動先の配置が別途リンクする)は
      //   振替先にしない。ここを緩めると「戻った振替」や移動元マーカーへ誤ってリンクする。
      for (const statusEntry of desk.statusSlots ?? []) {
        if (!statusEntry) continue
        if (statusEntry.status !== 'attended' && statusEntry.status !== 'absent-no-makeup') continue
        registerDestination(statusEntry, cell)
      }
    }
  }

  const destinationByStatusId = new Map<string, LinkedLessonDestination>()

  for (const cell of sortedCells) {
    for (const desk of cell.desks) {
      for (const statusEntry of desk.statusSlots ?? []) {
        if (!statusEntry) continue
        const linkKeys = resolveStatusLinkKeys(statusEntry, cell)
        for (const linkKey of linkKeys) {
          const destination = destinationByLinkKey.get(linkKey)
          if (!destination || destination.dateKey === cell.dateKey) continue
          destinationByStatusId.set(statusEntry.id, destination)
          break
        }
      }
    }
  }

  return destinationByStatusId
}

export function formatShortDateLabel(dateKey?: string) {
  if (!dateKey) return ''
  const [, month = '', day = ''] = dateKey.split('-')
  if (!month || !day) return ''
  return `${Number(month)}/${Number(day)}`
}

// スロットに表示する「移)日付」ラベルを解決する。
// 回帰防止: 実在の生徒が入っているスロット(hasStudent)では、滞留したステータス由来の
// 移動日付(moved / リンク先)を表示してはいけない。前の生徒の移動ステータスが残っていても、
// 上書きした新しい生徒が他人の移動日付を引き継がず、本人の makeupSourceDate のみを表示する。
export function resolveVisibleSlotDateLabel(params: {
  /** studentSlots に実在の生徒が入っているか (studentName が真) */
  hasStudent: boolean
  /** 生徒名 or ステータス名のどちらかがあるか (effectiveName が真) */
  hasContent: boolean
  resolvedLessonType: LessonType | null
  effectiveMakeupSourceDate?: string
  statusEntry?: Pick<StudentStatusEntry, 'status' | 'moveDestinationDateKey'> | null
  linkedDestinationDateKey?: string
}) {
  const { hasStudent, hasContent, resolvedLessonType, effectiveMakeupSourceDate, statusEntry, linkedDestinationDateKey } = params
  const makeupSourceDateLabel = hasContent && resolvedLessonType === 'makeup' ? formatShortDateLabel(effectiveMakeupSourceDate) : ''
  const moveDestinationDateLabel = !hasStudent && statusEntry?.status === 'moved' ? formatShortDateLabel(statusEntry.moveDestinationDateKey) : ''
  const linkedDestinationDateLabel = !hasStudent && statusEntry ? formatShortDateLabel(linkedDestinationDateKey) : ''
  return makeupSourceDateLabel || moveDestinationDateLabel || linkedDestinationDateLabel
}