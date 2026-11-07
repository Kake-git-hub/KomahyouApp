// 机の講師欄に出す文字(表示専用の純関数・2026-10-22)。
//
// テンプレの通常授業で講師が決まっていない行は、再マージ(ScheduleBoardScreen.tsx の管理データ配置)が机の teacher に
// 「講師未割当」という埋め草の文字を入れる(机を講師だけの机として確保し、再マージの不動点(INV-02 / INV-12)を保つための
// データ側の都合。initial backup 以来の形で、inv12 マトリクスのテストが期待値として持つ)。
// 室長の画面には出さない(オーナー指示 2026-10-22・確認リスト v1.5.625 その他「講師欄に 講師未割り当て がでているが、
// 以前消すようにしたはず。確認して」)。共有画面(BoardShareScreen)は以前から同じ 2 語を空白にしていたので、
// その判定をここへ一本化し、コマ表の講師欄(BoardGrid)・右の詳細(DetailPanel)・日程表タブの机一覧も同じ関数で空白にする。
// ★データ(desk.teacher)は変えない。空白にするのは**表示だけ**。机の同一性(日程表タブの deskTeacher 照合)や
//   「講師が居る机」の判定(teacher.trim() の有無)は従来どおり元の文字で行う。
// ★2026-11-07(オーナー指示「直して」・確認リスト tp-72 の準備の結果): 埋め草は**講師として数えない**。生徒を動かして空いた机で
//   v1.5.349 のガードが埋め草まで手置きの講師に固定し、テンプレ保存の詳細に「講師 講師未割当: 同じコマの机 n に手で置いた同じ講師が先にある…」
//   が出続けた。「本物の講師か」は hasRealDeskTeacher、「埋め草を手置きの印で固定した机か」は isPinnedPlaceholderTeacherDesk で判定する
//   (手置きの講師の判定・講師の一意・講師の休み・丸ごと振替の講師の移送・保存前レポート)。各所で文字列を比べ直さない。
//   机を確保する埋め草そのもの(再マージの不動点)と「講師が居る机」の判定(ドラッグ可否など)は変えない。

import type { DeskCell } from '../components/schedule-board/types'

/** 講師欄に出さない埋め草の文字。「講師未設定」は日程表タブ(scheduleViewMove)が講師の無い机に付ける表示名。 */
export const DESK_TEACHER_PLACEHOLDER_LABELS: readonly string[] = ['講師未割当', '講師未設定']

export function isDeskTeacherPlaceholder(teacher: string | null | undefined): boolean {
  if (typeof teacher !== 'string') return false
  return DESK_TEACHER_PLACEHOLDER_LABELS.includes(teacher.trim())
}

/** 本物の講師が居るか(空と埋め草は講師なし)。手置きの講師・講師の一意・講師の休みなど「講師として数える」判定はこれを使う。 */
export function hasRealDeskTeacher(teacher: string | null | undefined): boolean {
  if (typeof teacher !== 'string') return false
  return teacher.trim() !== '' && !isDeskTeacherPlaceholder(teacher)
}

/**
 * 埋め草を手置きの印(manualTeacher・由来)で固定した机か(2026-11-07)。v1.5.349 のガードが生徒を動かして空いた机の埋め草まで固定していた
 * 既に保存されたデータを「講師なし」として読むために使う。本物の講師・印の無い埋め草・削除記録(講師欄が空)は偽。
 */
export function isPinnedPlaceholderTeacherDesk(desk: Pick<DeskCell, 'teacher' | 'manualTeacher' | 'teacherAssignmentSource'>): boolean {
  return isDeskTeacherPlaceholder(desk.teacher) && (Boolean(desk.manualTeacher) || Boolean(desk.teacherAssignmentSource))
}

/** 講師欄の表示文字。埋め草なら空文字、それ以外はそのまま(trim もしない＝表示は従来どおり)。 */
export function formatDeskTeacherLabel(teacher: string | null | undefined): string {
  if (typeof teacher !== 'string') return ''
  return isDeskTeacherPlaceholder(teacher) ? '' : teacher
}

/**
 * テンプレ差分反映が同じコマの空き机へずらして置いたテンプレの講師か（Q41-13・オーナー指示 2026-10-22「詰めた講師は緑色で分かるように。保留ではない」）。
 * 印（templateTeacherShift）がこの机の今の講師と一致し、かつ非 manual のときだけ真。講師が替わった・手で置き直した・削除した後の古い印は無視する。
 * 盤面の表示（緑の講師欄とツールチップ）は 2026-11-05 のオーナー指示で廃止（緑は講師のぶつかりだけ）。今は templateDiffApply.ts が印の後始末の判定に使う。
 */
export function isShiftedTemplateTeacherDesk(desk: Pick<DeskCell, 'teacher' | 'manualTeacher' | 'templateTeacherShift'>): boolean {
  const shift = desk.templateTeacherShift
  if (!shift) return false
  if (desk.manualTeacher) return false
  const teacher = desk.teacher.trim()
  return teacher !== '' && teacher === shift.teacher.trim()
}
