// 室長による「自教室だけ」のサーバーバックアップ復元(オーナー確定 2026-09-18・docs/spec-save-restore.md §4-1)。
//
// 設計の要点(ここを崩すと 2026-06-06 の教室取り違え事故と同型の経路が生まれる):
//   - 復元は「画面へ読込 → 室長が保存して確定」。サーバーへ直接書く復元関数は作らない(既存の保存経路だけを通す)。
//   - 復元元は必ず【いま開いている教室 = 自分の担当教室】。室長は 3 者一致(担当 = 開いている = 復元対象)を要求する。
//   - サーバーが返した教室IDが要求した教室IDと違えば読み込まない(応答の取り違えを画面側でも止める)。
//   - 実行前に画面中央の大きな確認モーダルを必ず挟む(オーナー指示 2026-09-18: パスワード要求はやめて確認メッセージへ)。
//     そこに「復元しても戻らないもの」を必ず出す。権限はサーバーの担当教室判定が担う。
//   - 室長に見せる時点は直近 3 日分だけ(オーナー指示 2026-09-18・当初 7 日から短縮。15分毎＋毎時相当の範囲)。
//     それより前は開発者へ依頼する。

export const MANAGER_SELF_RESTORE_WINDOW_DAYS = 3

const DAY_IN_MS = 24 * 60 * 60 * 1000

export type ManagerSelfRestoreSummary = {
  backupDateKey: string
  displayLabel: string
  savedAt: string
  sourceSavedAt: string
}

// 一覧の問い合わせに使う下限時刻(ISO)。Firestore 側の where と画面側フィルタで同じ値を使う。
export function resolveManagerSelfRestoreCutoffIso(now: Date = new Date()): string {
  return new Date(now.getTime() - MANAGER_SELF_RESTORE_WINDOW_DAYS * DAY_IN_MS).toISOString()
}

// 室長に見せる復元候補: 直近 3 日以内(MANAGER_SELF_RESTORE_WINDOW_DAYS)・新しい順。保存時刻が読めないもの・未来時刻のものは出さない
// (時刻が読めない時点を選ばせると「いつの状態へ戻るか」を室長が判断できない)。
export function listManagerSelfRestoreCandidates<T extends ManagerSelfRestoreSummary>(summaries: readonly T[], now: Date = new Date()): T[] {
  const nowMs = now.getTime()
  const cutoffMs = nowMs - MANAGER_SELF_RESTORE_WINDOW_DAYS * DAY_IN_MS
  const seen = new Set<string>()
  return summaries
    .map((summary) => ({ summary, savedAtMs: Date.parse(summary.savedAt) }))
    .filter(({ summary, savedAtMs }) => {
      if (!summary.backupDateKey || Number.isNaN(savedAtMs)) return false
      if (savedAtMs < cutoffMs || savedAtMs > nowMs) return false
      if (seen.has(summary.backupDateKey)) return false
      seen.add(summary.backupDateKey)
      return true
    })
    .sort((left, right) => right.savedAtMs - left.savedAtMs)
    .map(({ summary }) => summary)
}

export type ManagerSelfRestoreGuardInput = {
  featureEnabled: boolean
  isRemoteBackendEnabled: boolean
  role: 'developer' | 'manager' | null | undefined
  assignedClassroomId: string | null | undefined
  actingClassroomId: string | null | undefined
  targetClassroomId: string | null | undefined
}

export type ManagerSelfRestoreGuardResult = { ok: true } | { ok: false; message: string }

// 復元を始めてよいかの判定。室長は「担当教室 = 開いている教室 = 復元対象」の 3 者一致が必須。
// 開発者は開発者画面の復元を持つが、開発用教室での検証のため「開いている教室 = 復元対象」なら通す
// (サーバー側 downloadClassroomFromServerAutoBackup も開発者を許可している)。
export function resolveManagerSelfRestoreGuard(input: ManagerSelfRestoreGuardInput): ManagerSelfRestoreGuardResult {
  if (!input.featureEnabled) return { ok: false, message: 'この教室ではサーバーバックアップからの復元はまだ使えません。' }
  if (!input.isRemoteBackendEnabled) return { ok: false, message: 'Firebase が無効のため、サーバーバックアップから復元できません。' }
  const acting = (input.actingClassroomId ?? '').trim()
  const target = (input.targetClassroomId ?? '').trim()
  if (!acting || !target) return { ok: false, message: '復元する教室を確認できませんでした。盤面を開き直してからもう一度お試しください。' }
  if (acting !== target) return { ok: false, message: 'いま開いている教室以外は復元できません。' }
  if (input.role === 'developer') return { ok: true }
  if (input.role !== 'manager') return { ok: false, message: 'ログイン状態を確認できませんでした。再ログイン後にもう一度お試しください。' }
  const assigned = (input.assignedClassroomId ?? '').trim()
  if (!assigned || assigned !== acting) return { ok: false, message: '自分の担当教室以外は復元できません。' }
  return { ok: true }
}

// サーバー応答の教室IDが、要求した(= いま開いている)教室IDと一致するか。違えば読み込まない。
export function isRestoreSourceForClassroom(sourceClassroomId: string | null | undefined, actingClassroomId: string | null | undefined): boolean {
  const source = (sourceClassroomId ?? '').trim()
  const acting = (actingClassroomId ?? '').trim()
  return source !== '' && source === acting
}

// 【INV-08】読み込んだデータで差し替えるのは、指定した 1 教室のスロットだけ。他教室の要素は**参照ごと**そのまま返す
// (他教室スロットを作り直すと、全教室保存経路の差分判定や参照共有の検査を狂わせる)。該当教室が無ければ何も変えない。
export function replaceClassroomData<TData, TClassroom extends { id: string; data: TData }>(
  classrooms: readonly TClassroom[],
  classroomId: string,
  data: TData,
): TClassroom[] {
  return classrooms.map((classroom) => (classroom.id === classroomId ? { ...classroom, data } : classroom))
}

// 復元しても戻らないもの(確認モーダルに必ず出す・オーナー指示 2026-09-18)。
// ★言葉はアプリの画面に出ている呼び名に合わせる。内部名(授業台帳 lessonLedgerDays・操作ログ operationEvents)は出さない。
//   授業台帳 = 生徒日程表の「通常授業履歴」ボタンで見える記録。
export const MANAGER_SELF_RESTORE_NOT_RESTORED_ITEMS: readonly string[] = [
  'QRで提出された講習の希望(生徒・講師の提出内容)',
  '保護者からの連絡',
  '生徒日程表の「通常授業履歴」に出る記録(出席・休み・振替の履歴)',
  '操作の記録(いつ・誰が・何を消したか)',
]

export type ManagerSelfRestoreConfirmInput = {
  classroomName: string
  backupLabel: string
  sourceSavedAt: string
  studentCount: number
  teacherCount: number
  templateCellCount: number
}

export type ManagerSelfRestoreConfirmation = {
  title: string
  headline: string
  sourceSavedAtLine: string
  scaleLine: string
  scaleHint: string
  notRestoredTitle: string
  notRestoredItems: readonly string[]
  notRestoredNote: string
  notes: string[]
  confirmLabel: string
  cancelLabel: string
}

function formatJa(iso: string): string {
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString('ja-JP')
}

// 確認モーダルの中身(バックアップ取得後に出す。取り違え防止のため規模を提示する = Feature B の確認と同じ作法)。
export function buildManagerSelfRestoreConfirmation(input: ManagerSelfRestoreConfirmInput): ManagerSelfRestoreConfirmation {
  return {
    title: 'サーバーバックアップから復元',
    headline: `「${input.classroomName || 'この教室'}」を ${input.backupLabel} の状態へ戻します。`,
    sourceSavedAtLine: input.sourceSavedAt ? `バックアップ内の最終保存: ${formatJa(input.sourceSavedAt)}` : '',
    scaleLine: `バックアップの中身: 生徒${input.studentCount}名 / 講師${input.teacherCount}名 / 通常授業テンプレ${input.templateCellCount}コマ`,
    scaleHint: 'この人数・コマ数が想定と違う場合は中止してください。',
    notRestoredTitle: '復元しても戻らないもの',
    notRestoredItems: MANAGER_SELF_RESTORE_NOT_RESTORED_ITEMS,
    notRestoredNote: 'これらは消えず、巻き戻りもしません(バックアップの時点より後の分もそのまま残ります)。',
    notes: [
      'いま開いているこの教室だけを戻します。他の教室には影響しません。',
      'まだ保存していない編集は失われます。',
      '読み込むと盤面に切り替わります。内容を確認して「保存」を押すと確定します(押すまでサーバーのデータは変わりません)。',
      '保存すると元に戻せません。保存前なら「直前の状態に戻す」で取り消せます。',
    ],
    confirmLabel: 'この時点を読み込む',
    cancelLabel: 'やめる',
  }
}
