// 基本データ（生徒）の「退塾」ボタン（純ロジック）。
//
// 目的（オーナー指示 2026-09-13）:
//   生徒の「削除」ボタンを廃止し「退塾」ボタンに置き換える。押した日を退塾日(withdrawDate)として記録し、
//   名簿データ自体は残す（後から退塾済み一覧で追える）。日付入力での退塾日設定も従来どおり残す。
//   ・名簿から物理削除しないため、生徒ID(sNNN)は欠番にならず再利用もされない（保護者QR・台帳の取り違え防止）。
//   ・2026-09-15 改定: 生徒の退塾日は「その日から非在籍」。押した瞬間に一覧は非在籍側へ移り、今日の盤面・日程表・
//     請求・保護者QRからも外れる（spec-basic-data.md §B/§H・isStudentWithdrawnOnDate）。
//   ・退塾日を消せば在籍に戻せる（可逆）ため、削除時のパスワード再認証は求めない。
import { isStudentDeletedFromApp, resolveManagedStudentRosterStatus } from './basicDataModel'
import type { StudentDeletionStock } from './deleteGuard'

type WithdrawTarget = { withdrawDate: string; birthDate: string }

// 在籍表示中の生徒にだけ「退塾」ボタンを出す。今日付けの退塾日が入った生徒は当日から非在籍なので出ない。
// 将来の退塾日が入っている生徒には出す（押すと今日付けに上書き＝確認画面で明示）。
export function canWithdrawStudentToday(student: WithdrawTarget, today: string): boolean {
  return resolveManagedStudentRosterStatus(student.withdrawDate, student.birthDate, today) === '在籍'
}

// 基本データの生徒一覧の振り分け(v1.5.527「退塾ボタンは押した瞬間に非表示に」)。
// 2026-09-15 改定(確認リスト v1.5.527 b-2): 生徒の在籍判定そのものを「退塾日当日から非在籍」に変えたため、
// v1.5.527 の「今日付けだけ一覧で特別扱い」は不要になり、共有の生徒判定 resolveManagedStudentRosterStatus と同一。
// ★講師用の resolveManagedRosterStatus(当日在籍)へ戻さない(押した直後に在籍一覧へ残る回帰になる)。
export function isStudentInWithdrawnRosterList(student: WithdrawTarget, today: string): boolean {
  return resolveManagedStudentRosterStatus(student.withdrawDate, student.birthDate, today) === '非在籍'
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
    message: `本日（${today}）を退塾日として記録します。本日から非在籍となり、一覧は「非在籍生徒表示」に移り、本日の盤面の通常授業・日程表・請求・保護者用QRからも外れます（手で置いた講習・振替のコマは残ります）。生徒のデータは削除されず残ります。取り消すときは「編集」から退塾日を消してください。`,
    overwriteNote,
    stockWarning,
  }
}

// ── 非在籍一覧の「削除」(オーナー指示 2026-09-13) ──
// 退塾済み(非在籍)の生徒だけを、アプリ上から消す。データ上は行を残し deletedAt(削除日時)を記録する。
// 在籍中の生徒は削除できない(先に「退塾」)。削除済みを二度削除しない。
export function canDeleteStudentFromApp(student: WithdrawTarget & { deletedAt?: string }, today: string): boolean {
  if (isStudentDeletedFromApp(student)) return false
  return resolveManagedStudentRosterStatus(student.withdrawDate, student.birthDate, today) === '非在籍'
}

// 行は消さずに deletedAt を記録する。既に記録済みなら最初の削除日時を保つ。
export function markStudentDeletedFromApp<T extends { id: string; deletedAt?: string }>(students: T[], id: string, nowIso: string): T[] {
  return students.map((row) => (row.id === id && !isStudentDeletedFromApp(row) ? { ...row, deletedAt: nowIso } : row))
}

// 基本データ画面に出す生徒(削除済みを除く)。
export function filterStudentsVisibleInBasicData<T extends { deletedAt?: string }>(students: T[]): T[] {
  return students.filter((row) => !isStudentDeletedFromApp(row))
}
