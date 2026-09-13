// 基本データ（生徒）の「退塾」ボタン（純ロジック）。
//
// 目的（オーナー指示 2026-09-13）:
//   生徒の「削除」ボタンを廃止し「退塾」ボタンに置き換える。押した日を退塾日(withdrawDate)として記録し、
//   名簿データ自体は残す（後から退塾済み一覧で追える）。日付入力での退塾日設定も従来どおり残す。
//   ・名簿から物理削除しないため、生徒ID(sNNN)は欠番にならず再利用もされない（保護者QR・台帳の取り違え防止）。
//   ・表示上は既存の在籍判定どおり「退塾日当日は在籍・翌日から退塾済み一覧」へ移る（spec-basic-data.md）。
//   ・退塾日を消せば在籍に戻せる（可逆）ため、削除時のパスワード再認証は求めない。
import { resolveEffectiveManagedWithdrawDate, resolveManagedRosterStatus } from './basicDataModel'
import type { StudentDeletionStock } from './deleteGuard'

type WithdrawTarget = { withdrawDate: string; birthDate: string }

// 在籍表示中で、まだ今日付けの退塾日が入っていない生徒にだけ「退塾」ボタンを出す。
// 将来の退塾日が入っている生徒には出す（押すと今日付けに上書き＝確認画面で明示）。
export function canWithdrawStudentToday(student: WithdrawTarget, today: string): boolean {
  if (resolveManagedRosterStatus(student.withdrawDate, student.birthDate, today) !== '在籍') return false
  return resolveEffectiveManagedWithdrawDate(student.withdrawDate, student.birthDate, today) !== today
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
    message: `本日（${today}）を退塾日として記録します。本日までは在籍扱いで、明日から「非在籍生徒表示」の一覧に移ります。生徒のデータは削除されず残ります。取り消すときは「編集」から退塾日を消してください。`,
    overwriteNote,
    stockWarning,
  }
}
