// 基本データ（生徒）の「退塾」ボタン（純ロジック）。
//
// 目的（オーナー指示 2026-09-13）:
//   生徒の「削除」ボタンを廃止し「退塾」ボタンに置き換える。押した日を退塾日(withdrawDate)として記録し、
//   名簿データ自体は残す（後から退塾済み一覧で追える）。日付入力での退塾日設定も従来どおり残す。
//   ・名簿から物理削除しないため、生徒ID(sNNN)は欠番にならず再利用もされない（保護者QR・台帳の取り違え防止）。
//   ・表示上は既存の在籍判定どおり「退塾日当日は在籍・翌日から退塾済み一覧」へ移る（spec-basic-data.md）。
//   ・退塾日を消せば在籍に戻せる（可逆）ため、削除時のパスワード再認証は求めない。
import { isStudentDeletedFromApp, resolveEffectiveManagedWithdrawDate, resolveManagedRosterStatus } from './basicDataModel'
import type { StudentDeletionStock } from './deleteGuard'

type WithdrawTarget = { withdrawDate: string; birthDate: string }

// 在籍表示中で、まだ今日付けの退塾日が入っていない生徒にだけ「退塾」ボタンを出す。
// 将来の退塾日が入っている生徒には出す（押すと今日付けに上書き＝確認画面で明示）。
export function canWithdrawStudentToday(student: WithdrawTarget, today: string): boolean {
  if (resolveManagedRosterStatus(student.withdrawDate, student.birthDate, today) !== '在籍') return false
  return resolveEffectiveManagedWithdrawDate(student.withdrawDate, student.birthDate, today) !== today
}

// 基本データの生徒一覧の振り分け(オーナー指示 2026-09-15・確認リスト その他「退塾ボタンは押した瞬間に非表示に」)。
// 退塾日が「今日」の生徒も、一覧だけはすぐ「非在籍生徒表示」側へ移す。退塾日は今日のまま記録するので、
// 盤面・請求・保護者QR など共有の在籍判定(当日は在籍)は変えない(前日付けにする案はオーナーが不採用)。
// ★resolveManagedRosterStatus 自体は変えない(講師一覧・削除可否・学年列は従来どおり当日在籍)。
export function isStudentInWithdrawnRosterList(student: WithdrawTarget, today: string): boolean {
  if (resolveManagedRosterStatus(student.withdrawDate, student.birthDate, today) === '非在籍') return true
  return resolveEffectiveManagedWithdrawDate(student.withdrawDate, student.birthDate, today) === today
}

// 押した日を退塾日として記録する。他の項目・他の生徒は変えない（行を消さない）。
export function applyStudentWithdrawToday<T extends { id: string; withdrawDate: string }>(students: T[], id: string, today: string): T[] {
  return students.map((row) => (row.id === id ? { ...row, withdrawDate: today } : row))
}

export type StudentWithdrawConfirmation = {
  title: string
  message: string
  // 既に将来の退塾日が入っているときだけ非 null。
  overwriteNote: string | null
  // 未消化の講習/振替が残るときだけ非 null。
  stockWarning: string | null
}

export function buildStudentWithdrawConfirmation(params: {
  name: string
  today: string
  currentWithdrawDate: string
  stock?: StudentDeletionStock
}): StudentWithdrawConfirmation {
  const { name, today, currentWithdrawDate, stock } = params
  const safeName = name.trim() || 'この生徒'
  const current = currentWithdrawDate.trim()
  const overwriteNote = current && current !== '未定' && current !== today
    ? `現在の退塾日（${current}）を ${today} に置き換えます。`
    : null

  let stockWarning: string | null = null
  if (stock) {
    const parts: string[] = []
    if (stock.lecture > 0) parts.push(`未消化の講習 ${stock.lecture} 件`)
    if (stock.makeup > 0) parts.push(`未消化の振替 ${stock.makeup} 件`)
    if (parts.length > 0) stockWarning = `${safeName} には ${parts.join(' と ')} が残っています。`
  }

  return {
    title: `${safeName} を退塾にします`,
    message: `本日（${today}）を退塾日として記録します。一覧からはすぐ「非在籍生徒表示」に移りますが、本日の授業・請求などは本日まで在籍扱いです。生徒のデータは削除されず残ります。取り消すときは「編集」から退塾日を消してください。`,
    overwriteNote,
    stockWarning,
  }
}

// ── 非在籍一覧の「削除」(オーナー指示 2026-09-13) ──
// 退塾済み(非在籍)の生徒だけを、アプリ上から消す。データ上は行を残し deletedAt(削除日時)を記録する。
// 在籍中の生徒は削除できない(先に「退塾」)。削除済みを二度削除しない。
export function canDeleteStudentFromApp(student: WithdrawTarget & { deletedAt?: string }, today: string): boolean {
  if (isStudentDeletedFromApp(student)) return false
  return resolveManagedRosterStatus(student.withdrawDate, student.birthDate, today) === '非在籍'
}

// 行は消さずに deletedAt を記録する。既に記録済みなら最初の削除日時を保つ。
export function markStudentDeletedFromApp<T extends { id: string; deletedAt?: string }>(students: T[], id: string, nowIso: string): T[] {
  return students.map((row) => (row.id === id && !isStudentDeletedFromApp(row) ? { ...row, deletedAt: nowIso } : row))
}

// 基本データ画面に出す生徒(削除済みを除く)。
export function filterStudentsVisibleInBasicData<T extends { deletedAt?: string }>(students: T[]): T[] {
  return students.filter((row) => !isStudentDeletedFromApp(row))
}
