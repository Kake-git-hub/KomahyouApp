// 基本データ（生徒/講師）削除時のガード（純ロジック）。
//
// 目的（オーナー指示 2026-07-08・富樫兄弟の誤削除インシデント）:
//   1. 未消化の講習/振替が残っている生徒を削除しようとしたら、その旨を明示して注意を促す。
//   2. 管理データの削除は不可逆であることを必ず伝える。
//   3. データは残したいだけなら「退塾日」で非表示にできることを案内する（手動 isHidden は廃止済み・
//      spec-basic-data.md §B/§C。隠すのは退塾日で代用するのが確定仕様）。
//
// 削除実行時のログインアカウント・パスワード再認証（reauthenticateFirebaseUser）は呼び出し側で行う。
// ここは「何を警告として出すか」だけを純関数で決める（UI/認証と分離してテスト可能にする）。

export type StudentDeletionStock = { lecture: number; makeup: number }
export type StudentDeletionStockSummary = Record<string, StudentDeletionStock>

// 盤面(ScheduleBoardScreen)が算出済みの講習/振替ストックから、生徒ID→残数の要約を作る。
// name: フォールバック等の非管理キー(studentId=null)は削除対象にならないため無視する。
export function deriveStudentDeletionStockSummary(
  lectureEntries: ReadonlyArray<{ studentId: string | null; requestedCount: number }>,
  makeupEntries: ReadonlyArray<{ studentId: string | null; balance: number }>,
): StudentDeletionStockSummary {
  const summary: StudentDeletionStockSummary = {}
  const bump = (studentId: string | null, key: keyof StudentDeletionStock, amount: number) => {
    if (!studentId || amount <= 0) return
    const current = summary[studentId] ?? { lecture: 0, makeup: 0 }
    current[key] += amount
    summary[studentId] = current
  }
  for (const entry of lectureEntries) bump(entry.studentId, 'lecture', entry.requestedCount)
  for (const entry of makeupEntries) bump(entry.studentId, 'makeup', entry.balance)
  return summary
}

export type DeleteScope = 'student' | 'teacher'

export const DELETE_IRREVERSIBLE_WARNING = '削除したデータは元に戻せません。'
export const DELETE_HIDE_ALTERNATIVE_HINT =
  'データを残したまま名簿・盤面・日程表から外したいだけなら、削除せず「退塾日」を設定してください（在籍者一覧や集計から自動的に外れます）。'

export type DeleteConfirmation = {
  title: string
  irreversibleWarning: string
  hideHint: string
  // 未消化の講習/振替が残る生徒のときだけ非 null。講師では常に null。
  stockWarning: string | null
  requiresPassword: boolean
}

export function buildDeleteConfirmation(params: {
  scope: DeleteScope
  name: string
  stock?: StudentDeletionStock
  requiresPassword: boolean
}): DeleteConfirmation {
  const { scope, name, stock, requiresPassword } = params
  const safeName = name.trim() || (scope === 'teacher' ? 'この講師' : 'この生徒')

  let stockWarning: string | null = null
  if (scope === 'student' && stock) {
    const parts: string[] = []
    if (stock.lecture > 0) parts.push(`未消化の講習 ${stock.lecture} 件`)
    if (stock.makeup > 0) parts.push(`未消化の振替 ${stock.makeup} 件`)
    if (parts.length > 0) {
      stockWarning = `${safeName} には ${parts.join(' と ')} が残っています。削除するとこれらも消え、復元できません。`
    }
  }

  return {
    title: `${safeName} を削除します`,
    irreversibleWarning: DELETE_IRREVERSIBLE_WARNING,
    hideHint: DELETE_HIDE_ALTERNATIVE_HINT,
    stockWarning,
    requiresPassword,
  }
}
