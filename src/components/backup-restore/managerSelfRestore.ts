// 室長による「自教室だけ」のサーバーバックアップ復元(オーナー確定 2026-09-18・docs/spec-save-restore.md §4-1)。
//
// 設計の要点(ここを崩すと 2026-06-06 の教室取り違え事故と同型の経路が生まれる):
//   - 復元は「画面へ読込 → 室長が保存して確定」。サーバーへ直接書く復元関数は作らない(既存の保存経路だけを通す)。
//   - 復元元は必ず【いま開いている教室 = 自分の担当教室】。室長は 3 者一致(担当 = 開いている = 復元対象)を要求する。
//   - サーバーが返した教室IDが要求した教室IDと違えば読み込まない(応答の取り違えを画面側でも止める)。
//   - パスワード再認証は誤操作・第三者操作の防止であって権限境界ではない(権限はサーバーの担当教室判定)。
//   - 室長に見せる時点は直近 7 日分だけ(15分毎の間引き系列)。それより前は開発者へ依頼する。

export const MANAGER_SELF_RESTORE_WINDOW_DAYS = 7

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

// 室長に見せる復元候補: 直近 7 日以内・新しい順。保存時刻が読めないもの・未来時刻のものは出さない
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

// パスワード入力モーダルに出す注意書き(復元で戻らないもの・未保存の編集が消えること)。
export const MANAGER_SELF_RESTORE_MODAL_NOTES: readonly string[] = [
  'いま開いているこの教室だけを、選んだ時点の状態へ戻します。他の教室には影響しません。',
  'まだ保存していない編集は失われます。',
  'QRで提出済みの講習希望・保護者からの連絡・操作ログ・授業台帳は復元の対象外です(消えません・巻き戻りません)。',
  '読み込んだあと盤面で内容を確認し、「保存」を押すと確定します。保存前なら「直前の状態に戻す」で取り消せます。',
]

export type ManagerSelfRestoreConfirmInput = {
  classroomName: string
  backupLabel: string
  sourceSavedAt: string
  studentCount: number
  teacherCount: number
  templateCellCount: number
}

function formatJa(iso: string): string {
  const parsed = new Date(iso)
  return Number.isNaN(parsed.getTime()) ? iso : parsed.toLocaleString('ja-JP')
}

// ダウンロード後の最終確認(取り違え防止のため規模を提示する。Feature B の確認と同じ作法)。
export function buildManagerSelfRestoreConfirmLines(input: ManagerSelfRestoreConfirmInput): string[] {
  return [
    `「${input.classroomName || 'この教室'}」を ${input.backupLabel} の状態へ戻します。`,
    ...(input.sourceSavedAt ? [`バックアップ内の最終保存: ${formatJa(input.sourceSavedAt)}`] : []),
    `バックアップの規模: 生徒${input.studentCount}名 / 講師${input.teacherCount}名 / テンプレ${input.templateCellCount}コマ`,
    'この人数・コマ数が想定と違う場合は中止してください。',
    '現在の画面のデータはこの内容で置き換わります。保存すると元に戻せません(保存前なら「直前の状態に戻す」で取り消せます)。',
    '読み込むと盤面に切り替わります。内容を確認してから「保存」を押すと確定します(押すまでサーバーのデータは変わりません)。',
    '読み込みますか?',
  ]
}
