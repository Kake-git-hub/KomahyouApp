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
//   ・2026-11-05 改定(オーナー確定・本番教室で室長が誤って退塾にした件): 「退塾生徒」一覧に**「退塾取消」**を足した
//     (canCancelStudentWithdrawal / applyStudentWithdrawCancel)。退塾日を未入力へ戻して在籍に戻す。
//     戻るもの = 未消化の振替・講習の残数(台帳に残っていて一覧で隠していただけ)と通常授業(テンプレ由来＝再マージで戻る)。
//     戻らないもの = 退塾スイープが消した今日以降の手置きのコマと出欠記録。今後の退塾だけ、消した内容を名簿行の
//     withdrawSweepRemovedLessons に残し(appendStudentWithdrawSweepRemovedLessons)、取消の確認画面に一覧で出す。
//     行ロック(isStudentRowLockedByWithdrawal)はそのまま: 退塾中の行を直接編集する入口は作らず、戻す入口は「退塾取消」1 つ。
import { isStudentDeletedFromApp, resolveManagedStudentRosterStatus, type StudentWithdrawRemovedLesson } from './basicDataModel'
import type { StudentDeletionStock } from './deleteGuard'
import { lessonTypeLabels } from '../schedule-board/mockData'
import type { StudentStatusKind } from '../schedule-board/types'

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
// 2026-11-05(退塾取消): 「戻らない授業」の記録 withdrawSweepRemovedLessons を [] で始める。盤面の退塾スイープが消した分を
// App が追記するので、取消の確認画面で「記録あり・0 件(消えた授業なし)」と「記録なし(この機能より前の退塾など)」を分けられる。
// 日付入力で退塾日を入れた経路は [] を入れない(未設定のまま。スイープが何かを消せばそこから記録が作られる)。
export function applyStudentWithdrawToday<T extends { id: string; withdrawDate: string; withdrawSweepRemovedLessons?: StudentWithdrawRemovedLesson[] }>(students: T[], id: string, today: string): T[] {
  return students.map((row) => (row.id === id ? { ...row, withdrawDate: today, withdrawSweepRemovedLessons: [] } : row))
}

// ── 退塾後の行は編集できない(オーナー確定 2026-09-20 夜) ────────────────────────────────────
// 退塾すると今日以降の盤面の痕跡が消えるため**元に戻せない**。在籍中(退塾日が未来)の生徒は退塾予定日を
// 早める/遅らせる/消すのが自由(まだ何も消えていない)。非在籍になった生徒は行ごと編集不可にし、
// 「削除」だけを残す(データ上から消す・元に戻せない)。
// 2026-11-05 追補: 在籍へ戻す入口は「退塾取消」(canCancelStudentWithdrawal / applyStudentWithdrawCancel)だけ。
// 行のロック自体は解かない(退塾日の入力を出すと、消えたコマが戻るように見える＝戻らないものを確認画面で必ず案内する)。
// ★判定は共有の在籍判定 resolveManagedStudentRosterStatus に委ねる(境界を別実装で持たない)。
export function isStudentRowLockedByWithdrawal(student: WithdrawTarget, today: string): boolean {
  return resolveManagedStudentRosterStatus(student.withdrawDate, student.birthDate, today) === '非在籍'
}

// ── 退塾後も生年月日だけは直せる(案2・オーナー確定 2026-09-21) ────────────────────────────────
// 行を完全ロックすると、生年月日の打ち間違い(例: 2017→2007)で誤って卒業=非在籍になった生徒を直す手段が
// 「削除して作り直す」しか無く、過去の記録や未消化とのつながりが切れる。生年月日だけは退塾後も編集できる。
// 退塾日・氏名などはロックのまま(在籍へ戻すのは「退塾取消」だけ・2026-11-05)。
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
  /**
   * 画面に出す 1 行(オーナー指示 2026-10-25「三行以上の長文を 1 行くらいに」)。
   * 2026-11-05(退塾取消): 「元に戻せません」→「退塾取消で在籍に戻せる」＋(掃除が有効な教室は)「今日以降に手で置いたコマと記録は消えて戻らない」を必ず含める。
   */
  summary: string
  /** 詳細(畳んだ中身)。従来の案内文そのまま。 */
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

  // ★2026-09-20 夜 改定で「退塾は元に戻せない」としたが、2026-11-05 改定(オーナー確定)で「退塾生徒」一覧の「退塾取消」で
  //   在籍に戻せるようになった。ただし退塾スイープが消した今日以降の手置きのコマと記録は戻らない。必ずそう案内する。
  //   「退塾取消」はフラグに依らず全教室で使える。「消えて戻りません」は掃除が有効な教室だけ(OFF の教室では消えない＝事実と違う)。
  const reversibleNote = autoSweepEnabled
    ? '★「退塾生徒」の「退塾取消」で在籍に戻せます（未消化の振替・講習の残数と通常授業は戻ります）が、今日以降に手で置いた講習・振替などのコマと記録は消えて戻りません。退塾中は生年月日のほかはその生徒の行を編集できません。生徒のデータは削除されず「退塾生徒」に残ります。'
    : '★「退塾生徒」の「退塾取消」で在籍に戻せます（未消化の振替・講習の残数と通常授業も戻ります）。退塾中は生年月日のほかはその生徒の行を編集できません。生徒のデータは削除されず「退塾生徒」に残ります。'
  const base = `本日（${today}）を退塾日として記録します。本日から非在籍となり、一覧は「退塾生徒」に移り、本日の盤面の通常授業・日程表・請求・保護者用QRからも外れます`
  // 掃除が有効な教室だけ「今日以降のコマと記録も消える」。OFF の教室は従来どおり手で置いたコマが残る。
  const sweepNote = autoSweepEnabled
    ? '。今日以降の講習・振替などのコマと記録も消えます（未消化へは戻りません）。昨日以前の記録は残ります。'
    : '（手で置いた講習・振替のコマは残ります）。'
  return {
    title: `${safeName} を退塾にします`,
    summary: autoSweepEnabled
      ? `本日（${today}）で退塾にします。「退塾取消」で在籍に戻せますが、今日以降に手で置いたコマと記録は消えて戻りません。`
      : `本日（${today}）で退塾にします。「退塾取消」で在籍に戻せます（データは「退塾生徒」に残ります）。`,
    message: `${base}${sweepNote}${reversibleNote}`,
    overwriteNote,
    stockWarning,
  }
}

// ── 退塾取消(オーナー確定 2026-11-05) ─────────────────────────────────────────────────────────
// 「退塾生徒」一覧の各行に出す。出す条件: アプリ上で削除済みでなく、今は退塾で行がロックされていて(非在籍)、
// 退塾日を外せば在籍になる生徒だけ。高3卒業済み(退塾日を外しても非在籍)には出さない(生年月日の打ち間違いは
// applyLockedStudentBirthDateCorrection の「生年月日を修正」で直す)。
// ★判定は共有の在籍判定 resolveManagedStudentRosterStatus に委ねる(境界を別実装で持たない)。
export function canCancelStudentWithdrawal(student: WithdrawTarget & { deletedAt?: string }, today: string): boolean {
  if (isStudentDeletedFromApp(student)) return false
  if (!isStudentRowLockedByWithdrawal(student, today)) return false
  return resolveManagedStudentRosterStatus('', student.birthDate, today) === '在籍'
}

// 退塾日を「未入力」へ戻して在籍に戻す。他の項目・他の生徒は変えない。保存はいつもの手動保存。
// ★未入力の値は空文字 ''。新規生徒行の既定値(studentDraft の withdrawDate: '')・入力欄の案内「未定の場合未入力」・
//   applyLockedStudentBirthDateCorrection と同じ。データには '未定' も残っているが(古いデータ・テスト用の名簿)、
//   在籍判定(normalizeDateText)ではどちらも「退塾日なし」で同じ扱いなので、今の画面が作る値の '' に揃える。
// ★外すもの: 高3卒業の自動入力の印(graduationWithdrawAutoFilledAt。残すと本当の卒業年度で 3/31 が入らない＝
//   applyLockedStudentBirthDateCorrection と同じ考え方)と、戻らない授業の記録(withdrawSweepRemovedLessons。
//   次に退塾したときは新しく記録し直す)。削除済みの行は触らない(ボタンも出ない)。
// ★盤面・在庫台帳には触らない。通常授業は名簿が変わったときの再マージで戻り、未消化は一覧の絞り込みが外れて戻る。
export function applyStudentWithdrawCancel<T extends { id: string; withdrawDate: string; deletedAt?: string; graduationWithdrawAutoFilledAt?: string; withdrawSweepRemovedLessons?: StudentWithdrawRemovedLesson[] }>(
  students: T[],
  id: string,
): T[] {
  return students.map((row) => {
    if (row.id !== id || isStudentDeletedFromApp(row)) return row
    const { graduationWithdrawAutoFilledAt: _autoFilledAt, withdrawSweepRemovedLessons: _removedLessons, ...rest } = row
    void _autoFilledAt
    void _removedLessons
    return { ...(rest as T), withdrawDate: '' }
  })
}

function buildStudentWithdrawRemovedLessonKey(lesson: StudentWithdrawRemovedLesson): string {
  return [lesson.dateKey, lesson.slotNumber, lesson.kind, lesson.lessonType, lesson.subject, lesson.status ?? ''].join('|')
}

// 盤面の退塾スイープが消した内容(results)を、該当の生徒の名簿行 withdrawSweepRemovedLessons へ**追記**する(App が呼ぶ)。
// 同じ内容は二重に足さない(同じ盤面で掃除が 2 回知らせても増えない)。記録の無い生徒(日付入力で退塾日を入れた生徒)にも、
// 消した分から記録を作る(消した事実は正しいので。「記録なし」の案内は、何も消していない生徒だけに残る)。
// 足すものが無ければ同じ配列を返す(開いただけで未保存にしない)。名簿に居ない生徒は無視する。
export function appendStudentWithdrawSweepRemovedLessons<T extends { id: string; withdrawSweepRemovedLessons?: StudentWithdrawRemovedLesson[] }>(
  students: T[],
  results: ReadonlyArray<{ studentId: string; removedLessons: ReadonlyArray<StudentWithdrawRemovedLesson> }>,
): T[] {
  const additionsById = new Map<string, StudentWithdrawRemovedLesson[]>()
  for (const result of results) {
    if (!result.studentId || result.removedLessons.length === 0) continue
    additionsById.set(result.studentId, [...(additionsById.get(result.studentId) ?? []), ...result.removedLessons])
  }
  if (additionsById.size === 0) return students
  let changed = false
  const next = students.map((row) => {
    const additions = additionsById.get(row.id)
    if (!additions) return row
    const current = row.withdrawSweepRemovedLessons ?? []
    const seen = new Set(current.map(buildStudentWithdrawRemovedLessonKey))
    const appended: StudentWithdrawRemovedLesson[] = []
    for (const lesson of additions) {
      const key = buildStudentWithdrawRemovedLessonKey(lesson)
      if (seen.has(key)) continue
      seen.add(key)
      appended.push({ ...lesson })
    }
    if (appended.length === 0) return row
    changed = true
    return { ...row, withdrawSweepRemovedLessons: [...current, ...appended] }
  })
  return changed ? next : students
}

const WITHDRAW_REMOVED_LESSON_WEEKDAYS = ['日', '月', '火', '水', '木', '金', '土'] as const
// 出欠記録の種類の呼び方(盤面の出欠メニューの語彙: 出席・休み・振無休・移動元・休日)。
const WITHDRAW_REMOVED_STATUS_LABELS: Record<StudentStatusKind, string> = {
  attended: '出席の記録',
  absent: '休みの記録',
  'absent-no-makeup': '振無休の記録',
  moved: '移動元の記録',
  holiday: '休日の記録',
}

/** 「戻らない授業」1 行: 「11/12(木) 3限 振替 国」。席の種類は盤面と同じ lessonTypeLabels(通常・振替・講習・増コマ・体験)。 */
export function formatStudentWithdrawRemovedLesson(lesson: StudentWithdrawRemovedLesson): string {
  const [year, month, day] = lesson.dateKey.split('-').map(Number)
  const valid = Number.isFinite(year) && Number.isFinite(month) && Number.isFinite(day)
  const dateLabel = valid
    ? `${month}/${day}(${WITHDRAW_REMOVED_LESSON_WEEKDAYS[new Date(Date.UTC(year, month - 1, day)).getUTCDay()]})`
    : lesson.dateKey
  const kindLabel = lesson.kind === 'status' && lesson.status
    ? WITHDRAW_REMOVED_STATUS_LABELS[lesson.status] ?? '記録'
    : lessonTypeLabels[lesson.lessonType] ?? lesson.lessonType
  return [dateLabel, `${lesson.slotNumber}限`, kindLabel, lesson.subject].filter((part) => String(part).trim()).join(' ')
}

export type StudentWithdrawCancelConfirmation = {
  title: string
  /** 畳まずに出す 1 行。 */
  summary: string
  /** listed = 戻らない授業が 1 件以上 / none = 記録あり 0 件 / unrecorded = 記録なし(この機能より前の退塾など)。 */
  removedLessonsState: 'listed' | 'none' | 'unrecorded'
  /** 戻らない授業の見出し(none / unrecorded のときはその 1 文)。 */
  removedLessonsHeading: string
  /** 戻らない授業の行(日付・時限の順)。listed のときだけ 1 件以上。 */
  removedLessonLines: string[]
  /** 詳細(畳んだ中身)。戻るもの・戻らないもの。 */
  message: string
}

export function buildStudentWithdrawCancelConfirmation(params: {
  name: string
  removedLessons: ReadonlyArray<StudentWithdrawRemovedLesson> | null | undefined
}): StudentWithdrawCancelConfirmation {
  const safeName = params.name.trim() || 'この生徒'
  const lessons = params.removedLessons
  const sorted = lessons
    ? [...lessons].sort((left, right) => (left.dateKey !== right.dateKey ? left.dateKey.localeCompare(right.dateKey) : left.slotNumber - right.slotNumber))
    : []
  const removedLessonsState: StudentWithdrawCancelConfirmation['removedLessonsState'] = !lessons
    ? 'unrecorded'
    : sorted.length > 0 ? 'listed' : 'none'
  const removedLessonsHeading = removedLessonsState === 'listed'
    ? '戻らない授業（退塾後に消えたもの。必要なら置き直してください）'
    : removedLessonsState === 'none'
      ? '退塾後に消えた授業はありません。'
      : '消えた授業の記録がありません（この機能を入れる前の退塾など）。'
  return {
    title: `${safeName} の退塾を取り消します`,
    summary: `${safeName} の退塾を取り消して在籍に戻します。`,
    removedLessonsState,
    removedLessonsHeading,
    removedLessonLines: sorted.map(formatStudentWithdrawRemovedLesson),
    message: '退塾日を未入力に戻し、在籍生徒の一覧へ戻します。戻るもの: 未消化の振替・講習の残数と通常授業。'
      + '戻らないもの: 退塾後に消えた手置きのコマ・出欠記録（講習・振替など。必要なら置き直してください）。'
      + '取り消したあとは「保存」で確定します。',
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
