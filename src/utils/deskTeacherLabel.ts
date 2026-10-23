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

import type { DeskCell } from '../components/schedule-board/types'

/** 講師欄に出さない埋め草の文字。「講師未設定」は日程表タブ(scheduleViewMove)が講師の無い机に付ける表示名。 */
export const DESK_TEACHER_PLACEHOLDER_LABELS: readonly string[] = ['講師未割当', '講師未設定']

export function isDeskTeacherPlaceholder(teacher: string | null | undefined): boolean {
  if (typeof teacher !== 'string') return false
  return DESK_TEACHER_PLACEHOLDER_LABELS.includes(teacher.trim())
}

/** 講師欄の表示文字。埋め草なら空文字、それ以外はそのまま(trim もしない＝表示は従来どおり)。 */
export function formatDeskTeacherLabel(teacher: string | null | undefined): string {
  if (typeof teacher !== 'string') return ''
  return isDeskTeacherPlaceholder(teacher) ? '' : teacher
}

/**
 * テンプレ差分反映が同じコマの空き机へずらして置いたテンプレの講師か（Q41-13・オーナー指示 2026-10-22「詰めた講師は緑色で分かるように。保留ではない」）。
 * 印（templateTeacherShift）がこの机の今の講師と一致し、かつ非 manual のときだけ真。講師が替わった・手で置き直した・削除した後の古い印は無視する。
 * 表示専用（緑の講師欄とツールチップ）。操作の制限は無い。
 */
export function isShiftedTemplateTeacherDesk(desk: Pick<DeskCell, 'teacher' | 'manualTeacher' | 'templateTeacherShift'>): boolean {
  const shift = desk.templateTeacherShift
  if (!shift) return false
  if (desk.manualTeacher) return false
  const teacher = desk.teacher.trim()
  return teacher !== '' && teacher === shift.teacher.trim()
}

/** ずらして置いた講師の講師欄のツールチップ。 */
export function describeShiftedTemplateTeacher(desk: Pick<DeskCell, 'teacher' | 'manualTeacher' | 'templateTeacherShift'>): string {
  if (!isShiftedTemplateTeacherDesk(desk)) return ''
  return `テンプレでは机 ${desk.templateTeacherShift!.fromDeskIndex + 1} の講師ですが、その机に手で置いた講師が居るため、この机へずらして置きました（保留ではありません。講師の変更・生徒の配置はできます）。`
}
