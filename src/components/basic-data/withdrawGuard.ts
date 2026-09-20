// 基本データ（生徒）の「退塾」ボタン（純ロジック）。
//
// 目的（オーナー指示 2026-09-13）:
//   生徒の「削除」ボタンを廃止し「退塾」ボタンに置き換える。押した日を退塾日(withdrawDate)として記録し、
//   名簿データ自体は残す（後から退塾済み一覧で追える）。日付入力での退塾日設定も従来どおり残す。
//   ・名簿から物理削除しないため、生徒ID(sNNN)は欠番にならず再利用もされない（保護者QR・台帳の取り違え防止）。
//   ・2026-09-15 改定: 生徒の退塾日は「その日から非在籍」。押した瞬間に一覧は非在籍側へ移り、今日の盤面・日程表・
//     請求・保護者QRからも外れる（spec-basic-data.md §B/§H・isStudentWithdrawnOnDate）。
//   ・退塾日を消せば在籍に戻せる（可逆）ため、削除時のパスワード再認証は求めない。
//   ・2026-09-20 改定（確認リスト b-2 要改善・オーナー確定）: 退塾ボタンは名簿の退塾日を記録するだけでなく、
//     **今日以降の盤面の痕跡**（手で置いた講習・振替・増コマ・体験・手動追加・移動の席と出欠記録）も消す
//     （退塾スイープ = computeStudentWithdrawSweep）。未消化へは戻さない。昨日以前の記録は残る。
//     退塾を取り消しても消したコマは戻らない（仕様）ので、確認モーダルで必ずそう案内する。
//   ・2026-09-20 夜 改定(オーナー確定): 退塾は**元に戻せない**操作になった。退塾後(非在籍)の行は一切編集できず
//     (退塾日も戻せない)、残るのは「削除」だけ(isStudentRowLockedByWithdrawal)。退塾日を直接入力した場合も
//     盤面側の検出(collectStudentWithdrawSweepTargets)で同じ消去が黙って走る。Excel 差分取り込みなど別経路で
//     退塾済みの行が書き換わらないようにもガードする(preserveWithdrawnStudentRowsOnImport)。
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

// ── 退塾後の行は編集できない(オーナー確定 2026-09-20 夜) ────────────────────────────────────
// 退塾すると今日以降の盤面の痕跡が消えるため**元に戻せない**。在籍中(退塾日が未来)の生徒は退塾予定日を
// 早める/遅らせる/消すのが自由(まだ何も消えていない)。非在籍になった生徒は行ごと編集不可にし、
// 「削除」だけを残す(データ上から消す・元に戻せない)。
// ★判定は共有の在籍判定 resolveManagedStudentRosterStatus に委ねる(境界を別実装で持たない)。
export function isStudentRowLockedByWithdrawal(student: WithdrawTarget, today: string): boolean {
  return resolveManagedStudentRosterStatus(student.withdrawDate, student.birthDate, today) === '非在籍'
}

// ── 退塾後も生年月日だけは直せる(案2・オーナー確定 2026-09-21) ────────────────────────────────
// 行を完全ロックすると、生年月日の打ち間違い(例: 2017→2007)で誤って卒業=非在籍になった生徒を直す手段が
// 「削除して作り直す」しか無く、過去の記録や未消化とのつながりが切れる。生年月日だけは退塾後も編集できる。
// 退塾日・氏名などはロックのまま(退塾は元に戻せない、は変えない)。
// ★生年月日を直して卒業扱いでなくなったら、**卒業で自動入力された退塾日**(graduationWithdrawAutoFilledAt の印つき)だけ
//   一緒に外す。外さないと退塾日 3/31 が残って行のロックが解けない。室長が手で入れた退塾日(印なし)は外さない。
//   印も外す(本当の卒業年度でもう一度自動入力されるように)。盤面で既に消えたコマは戻らない(仕様)。
export function applyLockedStudentBirthDateCorrection<T extends WithdrawTarget & { graduationWithdrawAutoFilledAt?: string }>(
  student: T,
  nextBirthDate: string,
  today: string,
): T {
  const corrected: T = { ...student, birthDate: nextBirthDate }
  if (!student.graduationWithdrawAutoFilledAt) return corrected
  // 退塾日を抜いた状態で在籍と判定される = 卒業扱いでなくなった。
  if (resolveManagedStudentRosterStatus('', nextBirthDate, today) !== '在籍') return corrected
  const { graduationWithdrawAutoFilledAt: _autoFilledAt, ...rest } = corrected
  void _autoFilledAt
  return { ...(rest as T), withdrawDate: '' }
}

// Excel 差分取り込みなど「名簿をまとめて置き換える」経路のガード。退塾済み(非在籍)の生徒の行は
// **取り込み前のまま**にする(退塾日が消える/変わる、他の項目が書き換わるのを防ぐ)。
// 取り込みで新しく現れた行・在籍中の行は従来どおり反映する。行の並びは取り込み結果の並びを保つ。
export function preserveWithdrawnStudentRowsOnImport<T extends WithdrawTarget & { id: string }>(
  importedStudents: ReadonlyArray<T>,
  currentStudents: ReadonlyArray<T>,
  today: string,
): T[] {
  const lockedById = new Map<string, T>()
  for (const student of currentStudents) {
    if (isStudentRowLockedByWithdrawal(student, today)) lockedById.set(student.id, student)
  }
  if (lockedById.size === 0) return [...importedStudents]
  const kept = importedStudents.map((student) => lockedById.get(student.id) ?? student)
  // 取り込み結果に入っていない退塾済みの行は落とさずに残す(名簿から消える方が危険＝安全側)。
  const importedIds = new Set(importedStudents.map((student) => student.id))
  for (const [id, student] of lockedById) {
    if (!importedIds.has(id)) kept.push(student)
  }
  return kept
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
  /**
   * 盤面の退塾掃除が有効な教室か(機能フラグ studentWithdrawAutoSweep・開発用教室限定で先行・2026-09-21)。
   * ★案内文が事実と食い違わないようにするための引数。OFF の教室では今日以降のコマ・記録は**消えない**
   *   (通常授業の剥がしだけ)ので「今日以降のコマと記録も消えます」と書いてはいけない。
   *   既定を false にしているのは「フラグを渡し忘れたら消えない側の案内になる」= 安全側に倒すため。
   */
  autoSweepEnabled?: boolean
}): StudentWithdrawConfirmation {
  const { name, today, currentWithdrawDate, stock, autoSweepEnabled = false } = params
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

  // ★2026-09-20 夜 改定: 退塾は元に戻せない(退塾後の行は編集できず、退塾日も戻せない)。必ずそう案内する。
  //   これはフラグに依らず全教室で同じ(行ロックは全教室で有効)。
  const irreversibleNote = '★退塾にすると元に戻せません（退塾後は退塾日も含めてその生徒の行を編集できません）。生徒のデータは削除されず「退塾生徒」に残ります。'
  const base = `本日（${today}）を退塾日として記録します。本日から非在籍となり、一覧は「退塾生徒」に移り、本日の盤面の通常授業・日程表・請求・保護者用QRからも外れます`
  // 掃除が有効な教室だけ「今日以降のコマと記録も消える」。OFF の教室は従来どおり手で置いたコマが残る。
  const sweepNote = autoSweepEnabled
    ? '。今日以降の講習・振替などのコマと記録も消えます（未消化へは戻りません）。昨日以前の記録は残ります。'
    : '（手で置いた講習・振替のコマは残ります）。'
  return {
    title: `${safeName} を退塾にします`,
    message: `${base}${sweepNote}${irreversibleNote}`,
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
