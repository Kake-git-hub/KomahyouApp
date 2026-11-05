// 出自の印（テンプレ／手入力）の権威関数（docs/spec-template-conflict-v2.md §1-1・§7・段 1）。
//
// ★読み手は必ずここを通す（manualAdded・lessonType・makeupSourceDate・teacherAssignmentSource を各所で直接読んで
//   「手入力か」を決め直さない＝二重管理にしない）。
// ★生徒の正本は `StudentEntry.origin`。置いた瞬間に付ける（コマ表の確定 commitWeeks が、印の無い生徒に下の推定で付ける・
//   科目／授業時間の手直し〔§9-11〕と別日への移動は呼び出し側が明示で 'manual' にする）。印の無い旧データは §7 の推定で読む
//   （読み込み時に stampPlacementOrigins が 1 回だけ付け、2 回目は何も変えない＝1-4）。
// ★講師は既存の `teacherAssignmentSource` がそのまま「置いた瞬間の印」なので、新しい保存項目は足さない（足すと講師ブロックの
//   入れ替え・削除・QR の自己修復など講師欄を書く全経路に配線が要り、1 つ漏れると印と講師名が食い違う）。判定はこの関数だけ。
// ★メモ・出欠記録は常に手入力（§1-1 #11・#12）。印を持たない。
// ★機能フラグ templateDiffApply が OFF の教室では、ここの結果で挙動を変えない（呼び出し側がフラグで分ける）。

import type { DeskCell, DeskLesson, PlacementOriginMark, SlotCell, StudentEntry } from './types'
import type { TemplatePendingDeskMap } from './templatePendingDesks'

export type PlacementOrigin = PlacementOriginMark

/** 出自＝手入力の青字のクラス（§5・盤面画面だけ）。盤面 PDF は stripTemplatePendingLowerForPdf（utils/pdf.ts）がクローンから外す。 */
export const MANUAL_ORIGIN_CLASS = 'sa-manual-origin'

/**
 * §7 の推定（印の無い生徒だけに使う）。手入力＝手動追加・在庫由来の振替（makeupSourceDate）・振替・講習・体験・増コマ・
 * 別日への移動先・編集で振替にした授業・編集で元の授業を置き換えたもの。テンプレ＝それ以外の通常授業
 * （テンプレの管理授業・同じ日の中で動かした通常授業〔sameDayMoveSourceDate＝§1-1 #2〕を含む）。
 */
export function inferStudentOrigin(student: Pick<StudentEntry, 'lessonType' | 'manualAdded' | 'makeupSourceDate' | 'editedToMakeup' | 'editedFromRegular' | 'wholeDayPairSourceDate'>): PlacementOrigin {
  if (student.manualAdded) return 'manual'
  if (student.editedToMakeup || student.editedFromRegular) return 'manual'
  // 段 4（§1-1 #17）: 丸ごと振替の付け替えで D' に展開した授業はテンプレ（付け替え）。振替（makeup）の形だが手入力にしない（青字にしない・
  // 再マージ／差分反映が D の新テンプレで置き直す）。科目・授業時間の手直し（origin='manual'）は resolveStudentOrigin の印が勝つ。
  if (student.wholeDayPairSourceDate) return 'template'
  if (student.lessonType !== 'regular') return 'manual'
  if (student.makeupSourceDate) return 'manual'
  return 'template'
}

/**
 * 生徒の出自。既存の手入力の印（手動追加・振替／講習などの区分・在庫由来・編集で振替にした印）があれば手入力（印 template より優先＝印の付け忘れ・
 * 読み込み時に template と付いた後の「編集」での区分の変更に対する二重の守り・regression-reviewer 重大-2）。無ければ印、印も無ければテンプレ。
 * ＝印が効くのは「推定ではテンプレだが手入力」（科目・授業時間の手直し §9-11 など）の形だけ。
 */
export function resolveStudentOrigin(student: Pick<StudentEntry, 'origin' | 'lessonType' | 'manualAdded' | 'makeupSourceDate' | 'editedToMakeup' | 'editedFromRegular' | 'wholeDayPairSourceDate'>): PlacementOrigin {
  if (inferStudentOrigin(student) === 'manual') return 'manual'
  return student.origin ?? 'template'
}

export function isManualOriginStudent(student: Pick<StudentEntry, 'origin' | 'lessonType' | 'manualAdded' | 'makeupSourceDate' | 'editedToMakeup' | 'editedFromRegular' | 'wholeDayPairSourceDate'> | null | undefined): boolean {
  return Boolean(student) && resolveStudentOrigin(student!) === 'manual'
}

/**
 * 机の講師の出自。手入力＝手で置いた講師（manual）・テンプレの講師を手で替えた講師（manual-replaced）・
 * QR 提出で自動で入った講師（schedule-registration・§9-13）・盤面の操作で名前を固定した講師（manualTeacher）。講師なし・削除記録（deleted）は null（講師が居ない）。
 * それ以外（テンプレの足場講師）はテンプレ。
 */
export function resolveDeskTeacherOrigin(desk: Pick<DeskCell, 'teacher' | 'manualTeacher' | 'teacherAssignmentSource'>): PlacementOrigin | null {
  if (!desk.teacher.trim()) return null
  const source = desk.teacherAssignmentSource
  if (source === 'manual' || source === 'manual-replaced' || source === 'schedule-registration') return 'manual'
  // 盤面の操作で名前を固定した講師（生徒を動かして空いた机・丸ごと振替で移した机＝manualTeacher のみ）も、人の操作の結果なので手入力
  // （再マージも manualTeacher の講師は動かさない・テンプレ保存の結果を再マージの不動点にするため同じ側に置く）。
  if (desk.manualTeacher) return 'manual'
  return 'template'
}

export function isManualOriginDeskTeacher(desk: Pick<DeskCell, 'teacher' | 'manualTeacher' | 'teacherAssignmentSource'>): boolean {
  return resolveDeskTeacherOrigin(desk) === 'manual'
}

/**
 * 「テンプレ由来の机」か（§2-1・§9-5: コマ表の並び替えで動かさない机）。テンプレの生徒が 1 人でも居る机、
 * または生徒が居ずテンプレの講師だけが居る机（足場）。手入力だけの机・空き机は並び替えで動く。
 */
export function isTemplateOriginDesk(desk: Pick<DeskCell, 'teacher' | 'manualTeacher' | 'teacherAssignmentSource' | 'lesson'>): boolean {
  const slots: ReadonlyArray<StudentEntry | null> = desk.lesson?.studentSlots ?? []
  const students = slots.filter((student): student is StudentEntry => Boolean(student))
  if (students.some((student) => resolveStudentOrigin(student) === 'template')) return true
  if (students.length === 0 && resolveDeskTeacherOrigin(desk) === 'template') return true
  return false
}

/** コマの中のテンプレ由来の机の ID（並び替えで位置を固定する・1-6）。 */
export function collectTemplateOriginDeskIds(cell: Pick<SlotCell, 'desks'>): Set<string> {
  return new Set(cell.desks.filter(isTemplateOriginDesk).map((desk) => desk.id))
}

function stampStudent(student: StudentEntry | null): StudentEntry | null {
  if (!student || student.origin) return student
  return { ...student, origin: inferStudentOrigin(student) }
}

function stampLesson(lesson: DeskLesson | undefined): DeskLesson | undefined {
  if (!lesson) return lesson
  const [first, second] = lesson.studentSlots
  if ((!first || first.origin) && (!second || second.origin)) return lesson
  return { ...lesson, studentSlots: [stampStudent(first), stampStudent(second)] }
}

function stampDesk(desk: DeskCell): DeskCell {
  const lesson = stampLesson(desk.lesson)
  return lesson === desk.lesson ? desk : { ...desk, lesson }
}

/**
 * 印の無い生徒に §7 の推定で印を付ける（盤面の上段・保留の下段）。印のある生徒は変えない＝2 回当てても結果は同じ（1-4）。
 * 変わらない週・セル・机・保留は参照ごと返す（再描画と保存差分を増やさない）。
 */
export function stampPlacementOrigins(weeks: SlotCell[][], pendingDesks?: TemplatePendingDeskMap | null): { weeks: SlotCell[][]; pendingDesks: TemplatePendingDeskMap | null | undefined } {
  let weeksChanged = false
  const nextWeeks = weeks.map((week) => {
    let weekChanged = false
    const nextWeek = week.map((cell) => {
      let cellChanged = false
      const desks = cell.desks.map((desk) => {
        const next = stampDesk(desk)
        if (next !== desk) cellChanged = true
        return next
      })
      if (!cellChanged) return cell
      weekChanged = true
      return { ...cell, desks }
    })
    if (!weekChanged) return week
    weeksChanged = true
    return nextWeek
  })
  let nextPending = pendingDesks
  if (pendingDesks) {
    let pendingChanged = false
    const entries = Object.entries(pendingDesks).map(([key, entry]) => {
      const lesson = stampLesson(entry.lower.lesson)
      if (lesson === entry.lower.lesson) return [key, entry] as const
      pendingChanged = true
      return [key, { ...entry, lower: { ...entry.lower, lesson } }] as const
    })
    if (pendingChanged) nextPending = Object.fromEntries(entries)
  }
  return { weeks: weeksChanged ? nextWeeks : weeks, pendingDesks: nextPending }
}

/** 移動の印（§1-1 #2・#7）: 同じ日の中の移動は元の印のまま、別の日へ移した先は手入力。印の無い旧データは推定に任せる（変えない）。 */
export function resolveMovedStudentOrigin(student: Pick<StudentEntry, 'origin'>, sourceDateKey: string, targetDateKey: string): PlacementOrigin | undefined {
  if (sourceDateKey === targetDateKey) return student.origin
  return student.origin ? 'manual' : undefined
}
