// 保存失敗・版数衝突の監視メール(2026-10-22 オーナー採用「即時対応のための案 6」・docs/runbooks/monitoring.md §3)。
//
// 保存の失敗は saveAttempts(status started/verification-failed)や関数ログには残るが、開発者が能動的に見に行かないと
// 気づけなかった。教室が増えると「別の端末で同時に開いた」(楽観ロックの版数衝突)や保存不良の発生確率が上がるので、
// 失敗したその場で開発者へメールする(利用者報告のメール即時通知と同じ SMTP 設定を使う。追加の設定は無い)。
//
// 決まり:
//  - 対象は 3 種: 版数衝突(stale-version)・保存後の読み戻し検証の失敗(readback-failed)・空の管理データでの上書き中止(data-loss-guard)。
//  - 連打を防ぐため **教室ごとに 1 時間に 1 通**(workspaces/{ws}/saveFailureAlerts/{classroomId}.lastSentAt で判定)。
//    送らなかった分も発生回数(occurrenceCount)と最後の発生時刻は同じ文書へ書く(「この 1 時間に何回起きたか」が残る)。
//  - ★メールの成否は保存の応答に影響させない(index.ts notifySaveFailureByMail が握る)。利用者には従来どおりの文言が返る。
//  - 本文に生徒名は入らない(教室名・保存 ID・版数・端末情報・原因文だけ)。

export const SAVE_FAILURE_ALERT_MIN_INTERVAL_MS = 60 * 60 * 1000
export const SAVE_FAILURE_ALERT_COLLECTION = 'saveFailureAlerts'

export const SAVE_FAILURE_ALERT_KINDS = ['stale-version', 'readback-failed', 'data-loss-guard'] as const
export type SaveFailureAlertKind = (typeof SAVE_FAILURE_ALERT_KINDS)[number]

export const SAVE_FAILURE_ALERT_LABELS: Readonly<Record<SaveFailureAlertKind, string>> = {
  'stale-version': '版数の衝突(別の端末が先に保存した・多端末の同時編集の疑い)',
  'readback-failed': '保存後の読み戻し検証に失敗(Firestore に書いた内容が読み戻せない)',
  'data-loss-guard': '空の管理データでの上書きを中止(破壊防止ガードが働いた)',
}

/** 何を見れば原因に近づけるか(種類ごと)。メール本文に載せる。 */
export const SAVE_FAILURE_ALERT_HINTS: Readonly<Record<SaveFailureAlertKind, string>> = {
  'stale-version': '同じ教室を 2 つの端末(またはタブ)で開いていないか室長に確かめる。送信版数とサーバー版数の差が 2 以上なら、古いタブで長く作業していた可能性。衝突したタブの内容はその端末の JSON バックアップに退避されている(spec-save-restore §1)。',
  'readback-failed': '関数ログ [saveClassroomSnapshot] と saveAttempts の errorMessage を見る。続けて起きるなら Firestore 側の障害か文書サイズの問題(1MiB)。',
  'data-loss-guard': '端末の教室データが空の状態で保存が走った(読み込み失敗・別教室のデータ混入など)。室長に画面を再読み込みして名簿が出るか確かめてもらう。saveAttempts には記録されない(保存前に止めている)。',
}

/** 教室ごとの間引き: 前回送信から 1 時間未満なら送らない。送信記録が無ければ送る。 */
export function shouldSendSaveFailureAlert(params: { lastSentAtIso?: string | null; nowMs: number; minIntervalMs?: number }): boolean {
  const lastSentMs = Date.parse(params.lastSentAtIso ?? '')
  if (!Number.isFinite(lastSentMs)) return true
  const minInterval = params.minIntervalMs ?? SAVE_FAILURE_ALERT_MIN_INTERVAL_MS
  // 未来の記録(時計ずれ)は「直前に送った」とみなして送らない(連打側に倒す)。
  return params.nowMs - lastSentMs >= minInterval
}

export function isSaveFailureAlertKind(value: unknown): value is SaveFailureAlertKind {
  return typeof value === 'string' && (SAVE_FAILURE_ALERT_KINDS as readonly string[]).includes(value)
}

function toJstLabel(iso: string | undefined): string {
  const ms = Date.parse(iso ?? '')
  if (!Number.isFinite(ms)) return iso || '(不明)'
  const jst = new Date(ms + 9 * 60 * 60 * 1000)
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${jst.getUTCFullYear()}-${pad(jst.getUTCMonth() + 1)}-${pad(jst.getUTCDate())} ${pad(jst.getUTCHours())}:${pad(jst.getUTCMinutes())}:${pad(jst.getUTCSeconds())} JST`
}

export type SaveFailureAlertMailInput = {
  kind: SaveFailureAlertKind
  workspaceKey: string
  classroomId: string
  classroomName?: string
  saveId: string
  savedAt: string
  occurredAt: string
  updatedBy: string
  appVersion?: string
  userAgent?: string
  /** 原因の補足(版数の差・エラー文など)。生徒名を入れない。 */
  detail?: string
  /** この 1 時間の発生回数(間引きで送らなかった分を含む)。 */
  occurrenceCount?: number
  projectId: string
}

export function buildSaveFailureAlertMail(input: SaveFailureAlertMailInput): { subject: string; text: string } {
  const classroom = input.classroomName?.trim() || input.classroomId
  const label = SAVE_FAILURE_ALERT_LABELS[input.kind]
  const subject = `【保存失敗】[コマ表アプリ 監視] ${input.workspaceKey} / ${classroom} / ${label.split('(')[0]}`
  const attemptPath = `workspaces/${input.workspaceKey}/classroomSnapshots/${input.classroomId}/saveAttempts/${input.saveId}`
  const lines = [
    '保存に失敗したため、アプリ(Cloud Function saveClassroomSnapshot)が自動で送った監視メールです。利用者には画面で失敗の文言が出ています。',
    '同じ教室の失敗は 1 時間に 1 通に絞っています(発生回数は下の値で分かる)。',
    '',
    `会社(workspace): ${input.workspaceKey}`,
    `教室: ${classroom} (${input.classroomId})`,
    `種類: ${label}`,
    `発生時刻: ${toJstLabel(input.occurredAt)} / 保存要求の時刻: ${toJstLabel(input.savedAt)}`,
    `保存 ID: ${input.saveId}`,
    `実行者(UID): ${input.updatedBy || '(不明)'}`,
    `端末: 版 ${input.appVersion || '(不明)'} / ${input.userAgent || '(UA 不明)'}`,
    typeof input.occurrenceCount === 'number' ? `この教室の発生回数(直近の通知以降を含む累計): ${input.occurrenceCount}` : '',
    input.detail ? `詳細: ${input.detail}` : '',
    '',
    '■ 確かめること',
    SAVE_FAILURE_ALERT_HINTS[input.kind],
    '',
    '■ 置き場所(読み取り専用トークンで読む・CLAUDE.md 本番データ保護ルール)',
    input.kind === 'data-loss-guard' ? '(保存前に止めたので saveAttempts には残らない)' : `saveAttempts: ${attemptPath}`,
    `操作痕跡(前回保存以降・保存に相乗り): workspaces/${input.workspaceKey}/classroomSnapshots/${input.classroomId}/operationTraces/`,
    `版履歴(保存ごと・gzip): gs://<bucket>/classroom-save-history/${input.workspaceKey}/${input.classroomId}/  → tools/snapshot-diff.mjs で前後を比べる`,
    `関数ログ: Actions「Read Cloud Functions logs」(saveClassroomSnapshot・${toJstLabel(input.occurredAt)} 前後)`,
    `Firestore コンソール: https://console.firebase.google.com/project/${input.projectId}/firestore`,
  ]
  return { subject, text: lines.filter((line) => line !== '').join('\n') }
}
