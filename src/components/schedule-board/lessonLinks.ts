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

// 「この記録が指す元コマ」のリンクキー。元コマを起点に振替先(destination)を引くために使う。
// ★起点になるのは **absent / moved / holiday** の3種(2026-09-16・振替元「休)」表示):
//   - absent  … 休んだ元コマ(従来どおり)。
//   - moved   … 別日へ移動した通常授業の**移動元**コマ。元コマは「その記録が載っているコマ自身」。
//               makeupSourceDate は「元々どの通常授業か」を指すだけなので、ここで使うと起点がズレる。
//   - holiday … 休日設定で消えたコマの表示専用記録。absent と同じ規則(makeupSourceDate があり当日と違う
//               =元が振替コマなら起点にしない。元の absent 記録側が既にリンクを持つため)。
// ★attended / absent-no-makeup は「実施済み/振替なしで処理済み」なので起点にしない(従来どおり)。
function resolveStatusLinkKeys(statusEntry: LessonLinkStatusEntry, cell: LessonLinkSlotCell) {
  if (statusEntry.status !== 'absent' && statusEntry.status !== 'moved' && statusEntry.status !== 'holiday') return []
  const isMovedSourceMarker = statusEntry.status === 'moved'
  if (!isMovedSourceMarker && statusEntry.makeupSourceDate && statusEntry.makeupSourceDate !== cell.dateKey) return []

  const stockKind: LinkedStockKind = statusEntry.lessonType === 'special' ? 'special' : 'makeup'
  const subject = statusEntry.subject
  const dateKey = isMovedSourceMarker ? cell.dateKey : (statusEntry.makeupSourceDate ?? cell.dateKey)
  const slotNumber = isMovedSourceMarker
    ? cell.slotNumber
    : (parseOriginSlotNumber(statusEntry.makeupSourceLabel) ?? cell.slotNumber)
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
      // ★holiday(休日設定で消えたコマの表示専用記録・2026-09-16)も同じ理由で振替先にしない
      //   (在庫は休日設定の時点で返却済み＝このコマは何も消化していない)。
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
  const moveDestinationDateLabel = !hasStudent && statusEntry?.status === 'moved'
    ? resolveMovedSourceDestinationLabel(statusEntry.moveDestinationDateKey, linkedDestinationDateKey)
    : ''
  // 回帰防止(2026-09-16): 移動先日付を持たない古い moved 記録は、リンク先があっても日付を出さない
  // (振替元「休)」表示のために moved も buildLinkedLessonDestinationMap の起点にしたので、無条件にリンク先へ
  // フォールバックさせると機能フラグ OFF の教室で古い記録の表示が変わる)。resolveMovedSourceDestinationLabel 参照。
  const linkedDestinationDateLabel = !hasStudent && statusEntry && statusEntry.status !== 'moved'
    ? formatShortDateLabel(linkedDestinationDateKey)
    : ''
  return makeupSourceDateLabel || moveDestinationDateLabel || linkedDestinationDateLabel
}

// 移動元マーカー(moved)に添える「移動先の日付」。盤面(resolveVisibleSlotDateLabel)と配布用盤面
// (BoardShareScreen getVisibleDateLabel)が共有する唯一の解決規則。
// ★確認リスト v1.5.555 その他欄(2026-09-22)「盤面で振替し、さらにそこから再度別日に振り替えたとき、元の授業の
//   振替先日が追いついていません。日程表は問題ない」の修正:
//   通常授業 A を別日 B へ動かすと A に moved 記録(moveDestinationDateKey = B)が残る。その振替コマを B から C へ
//   さらに動かしても、A の記録が持つ B は書き換わらない(記録は移動時に 1 度だけ作る・INV-06 の会計は移動先が持つ)。
//   一方リンク解決(buildLinkedLessonDestinationMap)は「今その授業が置かれているコマ」= C を指すので、
//   生徒日程表(scheduleViewData / scheduleHtml: リンク先 → 自分の移動先 の順)は正しく C を出していた。
//   盤面だけが自分の B を出していたので、同じ順(リンク先 → 自分の移動先)に揃える。
// ★ただし**移動先日付を持たない古い moved 記録**はリンク先があっても空のまま(2026-09-16 の回帰防止をそのまま維持:
//   機能フラグ OFF の教室で古い記録の表示を変えない)。リンク先を使うのは「自分の移動先を持つ記録」だけ。
// ★リンクが引けないとき(移動先を休みにして未消化へ戻した・移動先が消えた 等)は自分の移動先を出す(従来どおり)。
export function resolveMovedSourceDestinationLabel(moveDestinationDateKey: string | undefined, linkedDestinationDateKey: string | undefined) {
  if (!moveDestinationDateKey) return ''
  return formatShortDateLabel(linkedDestinationDateKey) || formatShortDateLabel(moveDestinationDateKey)
}