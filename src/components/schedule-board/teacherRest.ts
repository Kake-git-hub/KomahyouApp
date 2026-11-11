// 講師の休み（docs/spec-template-conflict-v2.md §2-4・§5・§9 決定記録 4・7・8・段 3）の権威関数。
//
// ★休みは「日付×時限×講師」の記録（机に持つが、効き目はそのコマのどの机にも及ぶ）。テンプレ保存の差分反映（computeTemplateDiffApply）と
//   盤面の再マージ（applyTemplateOriginRulesToManagedCell）が同じ述語 buildTemplateTeacherRestPredicate を通す（片方だけ見ると保存直後の
//   再マージで盤面が書き換わる＝INV-03 の不動点が崩れる）。
// ★休みの机は teacher を空にする（講師日程表・PDF・保護者 QR は盤面の写しなので、講師なしの机として出る・§2-4「見せる場所はコマ表の画面だけ」）。
//   休みにした講師は teacherRest に残し、盤面の画面だけがグレーの「休」として見せる。
// ★講師の削除記録（teacherAssignmentSource='deleted'・isDeletedTeacherTombstone）とは別（§9-8）。休みにしても削除記録にしない・削除しても休みにしない。
// ★単位は 1 コマ（机）ごと。「この日全部」の一括操作は作らない（§9-4）。操作ログにも残さない（§9-8）。
// ★機能フラグ templateDiffApply が OFF の教室では書かない（ボタンを出さない）。読み手は記録が無ければ何もしない＝OFF の教室の挙動は不変。

import type { DeskCell, SlotCell } from './types'
import type { TemplateTeacherRestPredicate } from './templateConflictRules'
import { isSameTeacherRecord, type TeacherAliasResolver } from './templateDiffApply'
import { hasRealDeskTeacher } from '../../utils/deskTeacherLabel'

export type DeskTeacherRest = NonNullable<DeskCell['teacherRest']>

const defaultTeacherAliases: TeacherAliasResolver = (key) => [key]

/** 盤面画面の休みの机の講師欄に付けるクラス（グレー）。盤面 PDF は stripTemplatePendingLowerForPdf（utils/pdf.ts）がクローンから外す。 */
export const TEACHER_REST_CELL_CLASS = 'sa-teacher-rest'
/** 休みの机の講師欄に出す「休」＋講師名の要素のクラス（PDF では要素ごと外す）。 */
export const TEACHER_REST_LABEL_CLASS = 'sa-teacher-rest-label'

export function hasDeskTeacherRest(desk: Pick<DeskCell, 'teacherRest'> | null | undefined): boolean {
  return Boolean(desk?.teacherRest && (desk.teacherRest.teacher.trim() || desk.teacherRest.teacherId?.trim()))
}

/** 休みの記録がこの講師（表示名か ID）と同じ講師か。呼び名の対応表（講師 ID・登録名・表示名）で重なりを見る（講師の一意判定と同じ鍵）。 */
export function doesTeacherRestMatch(rest: DeskTeacherRest, teacher: Pick<DeskCell, 'teacher' | 'teacherAssignmentTeacherId'>, aliases: TeacherAliasResolver = defaultTeacherAliases): boolean {
  // 照合の本体は講師欄の採用の記録と共有（templateDiffApply.ts の isSameTeacherRecord・中身は 2026-11-07 までここにあったものと同じ）。
  return isSameTeacherRecord(rest, teacher, aliases)
}

/** そのコマ（机のどれか）にこの講師の休みがあるか（§2-4「X の休みがそのコマにある」）。 */
export function isTeacherRestedInCell(cell: Pick<SlotCell, 'desks'>, teacher: Pick<DeskCell, 'teacher' | 'teacherAssignmentTeacherId'>, aliases: TeacherAliasResolver = defaultTeacherAliases): boolean {
  if (!teacher.teacher.trim() && !teacher.teacherAssignmentTeacherId?.trim()) return false
  return cell.desks.some((desk) => hasDeskTeacherRest(desk) && doesTeacherRestMatch(desk.teacherRest!, teacher, aliases))
}

const cellRestKey = (dateKey: string, slotNumber: number) => `${dateKey}_${slotNumber}`

/**
 * 盤面の休みの記録から、差分反映と再マージが当てる述語（templateConflictRules.ts の TemplateTeacherRestPredicate）を作る。
 * 鍵は日付×時限（盤面のセル id ではなく日付×時限で引く＝テンプレの管理セルと盤面のセルの突き合わせ方に依らない）。
 * 休みが 1 件も無ければ noTemplateTeacherRest と同じ「常に休みでない」を返す。
 */
export function buildTemplateTeacherRestPredicate(weeks: ReadonlyArray<ReadonlyArray<Pick<SlotCell, 'dateKey' | 'slotNumber' | 'desks'>>>, aliases: TeacherAliasResolver = defaultTeacherAliases): TemplateTeacherRestPredicate | null {
  const restsByCell = new Map<string, DeskTeacherRest[]>()
  for (const week of weeks) for (const cell of week) for (const desk of cell.desks) {
    if (!hasDeskTeacherRest(desk)) continue
    const key = cellRestKey(cell.dateKey, cell.slotNumber)
    restsByCell.set(key, [...(restsByCell.get(key) ?? []), desk.teacherRest!])
  }
  if (restsByCell.size === 0) return null
  return (cell, teacher) => (restsByCell.get(cellRestKey(cell.dateKey, cell.slotNumber)) ?? []).some((rest) => doesTeacherRestMatch(rest, teacher, aliases))
}

/**
 * 机の講師を休みにする（§2-4）。講師欄を空にし（手置きの印・日程表登録の印も外す＝別の講師はテンプレどおり置ける）、休みにした講師を teacherRest に残す。
 * 生徒・メモ・出欠記録は残す（§9-7）。講師が居ない机・既に休みの机は変えない（null）。
 */
export function restDeskTeacher(desk: DeskCell, resolveTeacherId?: (teacherName: string) => string | undefined): DeskCell | null {
  const teacherName = desk.teacher.trim()
  // 講師の居ない行の机の埋め草「講師未割当」は講師ではない＝休みにできない（2026-11-07・utils/deskTeacherLabel.ts）。
  if (!hasRealDeskTeacher(teacherName) || hasDeskTeacherRest(desk)) return null
  const teacherId = desk.teacherAssignmentTeacherId?.trim() || resolveTeacherId?.(teacherName) || undefined
  const sessionId = desk.teacherAssignmentSource === 'schedule-registration' ? desk.teacherAssignmentSessionId : undefined
  const next: DeskCell = {
    ...desk,
    teacher: '',
    manualTeacher: false,
    teacherAssignmentSource: undefined,
    teacherAssignmentSessionId: undefined,
    teacherAssignmentTeacherId: undefined,
    teacherRest: { teacher: desk.teacher, ...(teacherId ? { teacherId } : {}), ...(sessionId ? { sessionId } : {}) },
  }
  // 講師が居なくなるので、講師に付いていた画面だけの印（出席不可の警告・ずらした講師の緑）は外す。
  delete next.teacherUnavailableWarning
  delete next.templateTeacherShift
  // 準備で置いた講師の印（確認リストの後片づけの見分け・spec-developer-report §E-2-4-2）も外す（講師が居なくなった机）。
  delete next.checklistPrepTeacher
  return next
}

/** 休みを解除する（記録を消すだけ。講師欄は今のまま＝空なら空。次の反映でテンプレの講師が戻る・§2-4）。休みの無い机は null。 */
export function releaseDeskTeacherRest(desk: DeskCell): DeskCell | null {
  if (!desk.teacherRest) return null
  const next: DeskCell = { ...desk }
  delete next.teacherRest
  return next
}

/**
 * §9-19（オーナー決定 2026-11-05）・§9-25（オーナー決定 2026-11-11・案 1）: 講師を**手で**置いたら、そのコマ（日付×時限）にある
 * その講師本人の休みの記録を**全部**消す（休みにした机でも、代わりの講師 Y を置いた机でも、別の机でも。グレーが消える・次の反映でテンプレどおり）。
 * §9-19（休みにした机へ本人を置き直す）はこの特別な場合。「X は休みなのに盤面に居る」形を手の操作で作れなくする
 * （残るとテンプレ保存の合流〔§9-23・templateDeskOrderRestore.ts〕が 1 回目と 2 回目で食い違う穴になる＝INV-03）。
 * ★休みの数え方はこの 1 本だけ（机単位とコマ単位の 2 つを作らない）。照合は doesTeacherRestMatch（呼び名の対応表）。
 * ★別の講師を置いたときは記録を残す（§2-4「別の講師を手で置いて上書きできる。休みの記録は残る」）。Y の机のほかの項目（Y・生徒・メモ・出欠）は触らない。
 * ★呼ぶのは講師を手で置く経路だけ（講師メニューの「保存」と確認リストの準備＝setManualTeacherAssignment・講師の D&D／入れ替え＝computeTeacherMove・
 *   保留の下の行の講師の採用＝computePendingTeacherChoice）。再マージ・差分反映・講習の自動割振・QR 提出の反映・丸ごと振替の付け替えでは呼ばない（休みが勝つ）。
 * ★desks（そのコマの机の並び・置いた机を含む）の机をその場で書き換える（teacherRest を消すだけ）。呼び出し側は書き換えてよい写しを渡す。
 *   解除の知らせは出さない（§9-25）。元に戻す（Undo）は操作の前の週データの写しを戻すので記録も戻る。1 つでも消したら true。
 */
export function releaseTeacherRestInCellIfSameTeacherPlaced(desks: DeskCell[], placed: Pick<DeskCell, 'teacher' | 'teacherAssignmentTeacherId'>, aliases: TeacherAliasResolver = defaultTeacherAliases): boolean {
  if (!placed.teacher.trim()) return false
  let released = false
  for (const desk of desks) {
    if (!desk.teacherRest || !doesTeacherRestMatch(desk.teacherRest, placed, aliases)) continue
    delete desk.teacherRest
    released = true
  }
  return released
}

/**
 * §9-19 の机 1 つだけを見る形（コマの机の並びを持たない呼び出しの包み）。中身は releaseTeacherRestInCellIfSameTeacherPlaced に机 1 つを渡すだけ。
 * 盤面の手置きの経路はコマ全体を渡すこと（§9-25・この包みを使うと別の机の記録が残る）。机をその場で書き換え、解除したら true。
 */
export function releaseTeacherRestIfSameTeacherPlaced(desk: DeskCell, aliases: TeacherAliasResolver = defaultTeacherAliases): boolean {
  return releaseTeacherRestInCellIfSameTeacherPlaced([desk], desk, aliases)
}

export type ToggleDeskTeacherRestResult =
  | { status: 'rested' | 'released'; nextWeeks: SlotCell[][]; message: string; teacherName: string }
  | { status: 'blocked'; message: string }

/**
 * 講師欄のメニューの「休み」ボタン（同じボタンで解除）。休みの記録がある机は解除、無ければ今の講師を休みにする。
 * 渡した weeks は書き換えない（対象の週・セル・机だけ作り直す）。
 */
export function computeToggleDeskTeacherRest(params: {
  weeks: SlotCell[][]
  weekIndex: number
  cellId: string
  deskIndex: number
  resolveTeacherId?: (teacherName: string) => string | undefined
}): ToggleDeskTeacherRestResult {
  const week = params.weeks[params.weekIndex]
  const cellIndex = week?.findIndex((cell) => cell.id === params.cellId) ?? -1
  const cell = cellIndex >= 0 ? week![cellIndex] : undefined
  const desk = cell?.desks[params.deskIndex]
  if (!cell || !desk) return { status: 'blocked', message: '対象の机が見つかりませんでした。' }
  if (!cell.isOpenDay) return { status: 'blocked', message: '休校のコマでは講師を休みにできません。' }
  const released = releaseDeskTeacherRest(desk)
  const nextDesk = released ?? restDeskTeacher(desk, params.resolveTeacherId)
  if (!nextDesk) return { status: 'blocked', message: '講師がいない机は休みにできません。' }
  const teacherName = released ? desk.teacherRest!.teacher : desk.teacher
  const nextCell: SlotCell = { ...cell, desks: cell.desks.map((entry, index) => (index === params.deskIndex ? nextDesk : entry)) }
  const nextWeeks = params.weeks.map((entry, index) => (index !== params.weekIndex ? entry : entry.map((item, itemIndex) => (itemIndex === cellIndex ? nextCell : item))))
  const place = `${cell.dateLabel} ${cell.slotLabel} / ${params.deskIndex + 1}机目`
  return released
    ? { status: 'released', nextWeeks, teacherName, message: `${place} の講師 ${teacherName} の休みを解除しました。次にテンプレを反映するとテンプレの講師が戻ります。` }
    : { status: 'rested', nextWeeks, teacherName, message: `${place} の講師 ${teacherName} を休みにしました。机の生徒はそのまま（講師なし）です。` }
}
