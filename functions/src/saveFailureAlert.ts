// 保存失敗・版数衝突の監視メール(2026-10-22 オーナー採用「即時対応のための案 6」・docs/runbooks/monitoring.md §3)。
//
// 保存の失敗は saveAttempts(status started/verification-failed)や関数ログには残るが、開発者が能動的に見に行かないと
// 気づけなかった。教室が増えると「別の端末で同時に開いた」(楽観ロックの版数衝突)や保存不良の発生確率が上がるので、
// 失敗したその場で開発者へメールする(利用者報告のメール即時通知と同じ SMTP 設定を使う。追加の設定は無い)。
//
// 決まり:
//  - 対象: 版数衝突(stale-version)・保存後の読み戻し検証の失敗(readback-failed)・空の管理データでの上書き中止(data-loss-guard)・
//    容量超過で保存できない(snapshot-too-large)・書き込みの想定外の失敗(write-failed)・上限が近い(capacity-warning・保存は成功)。
//    2026-10-27: 日大前校が 1 文書の上限を超えて 3 時間保存できなかったのに、どの種類にも当たらずメールが来なかったので後ろ 3 種を足した。
//  - capacity-warning は失敗の通知と間引きを分ける(文書 {classroomId}__capacity・1 日 1 通)。上限が近い通知が本物の失敗の通知を
//    1 時間黙らせないため。
//  - 連打を防ぐため **教室ごとに 1 時間に 1 通**(workspaces/{ws}/saveFailureAlerts/{classroomId}.lastSentAt で判定)。
//    送らなかった分も発生回数(occurrenceCount)と最後の発生時刻は同じ文書へ書く(「この 1 時間に何回起きたか」が残る)。
//  - ★メールの成否は保存の応答に影響させない(index.ts notifySaveFailureByMail が握る)。利用者には従来どおりの文言が返る。
//  - 本文に生徒名は入らない(教室名・保存 ID・版数・端末情報・原因文だけ)。

export const SAVE_FAILURE_ALERT_MIN_INTERVAL_MS = 60 * 60 * 1000
/** 上限が近い通知(capacity-warning)の間引き間隔。失敗ではないので 1 日 1 通。 */
export const SAVE_CAPACITY_ALERT_MIN_INTERVAL_MS = 24 * 60 * 60 * 1000

/** 間引きの記録文書の id と間隔。capacity-warning だけ失敗の通知と別の文書で数える。 */
export function resolveSaveFailureAlertThrottle(kind: SaveFailureAlertKind, classroomId: string): { docId: string; minIntervalMs: number } {
  if (kind === 'capacity-warning') return { docId: `${classroomId}__capacity`, minIntervalMs: SAVE_CAPACITY_ALERT_MIN_INTERVAL_MS }
  // 第 2 段着手の合図(分割保存 §9-3-7)も失敗ではないので別文書で 1 日 1 通。
  if (kind === 'split-capacity-notice') return { docId: `${classroomId}__split`, minIntervalMs: SAVE_CAPACITY_ALERT_MIN_INTERVAL_MS }
  return { docId: classroomId, minIntervalMs: SAVE_FAILURE_ALERT_MIN_INTERVAL_MS }
}
/**
 * メール通知に使ってよい時間の上限(regression-reviewer M-1・2026-10-22)。保存の callable は 120 秒で、
 * nodemailer の既定(接続 2 分・ソケット 10 分)のまま待つと SMTP が止まった晩に保存の失敗応答が deadline-exceeded に化け、
 * 利用者に出る文言(版数衝突の案内など)が変わってしまう。上限を過ぎたら送らずに本来の失敗応答へ進む。
 */
export const SAVE_FAILURE_ALERT_TIMEOUT_MS = 5_000
/** SMTP 接続の各段の上限(nodemailer transport options)。上の全体上限より短くして、個々の待ちで全体を食い切らない。 */
export const SAVE_FAILURE_ALERT_SMTP_TIMEOUTS = { connectionTimeout: 3_000, greetingTimeout: 3_000, socketTimeout: 4_000 } as const

/** 約束を時間で打ち切る。時間切れは fallback を返す(例外にしない)。タイマーは必ず片づける。 */
export function withTimeout<T>(promise: Promise<T>, timeoutMs: number, fallback: T): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined
  const timeout = new Promise<T>((resolve) => {
    timer = setTimeout(() => resolve(fallback), Math.max(0, timeoutMs))
  })
  return Promise.race([promise, timeout]).finally(() => {
    if (timer) clearTimeout(timer)
  })
}
export const SAVE_FAILURE_ALERT_COLLECTION = 'saveFailureAlerts'

export const SAVE_FAILURE_ALERT_KINDS = ['stale-version', 'readback-failed', 'data-loss-guard', 'snapshot-too-large', 'write-failed', 'capacity-warning', 'snapshot-assembly-failed', 'client-too-old', 'split-capacity-notice'] as const
export type SaveFailureAlertKind = (typeof SAVE_FAILURE_ALERT_KINDS)[number]

export const SAVE_FAILURE_ALERT_LABELS: Readonly<Record<SaveFailureAlertKind, string>> = {
  'stale-version': '版数の衝突(別の端末が先に保存した・多端末の同時編集の疑い)',
  'readback-failed': '保存後の読み戻し検証に失敗(Firestore に書いた内容が読み戻せない)',
  'data-loss-guard': '空の管理データでの上書きを中止(破壊防止ガードが働いた)',
  'snapshot-too-large': '教室データが 1 文書の上限(1MiB)を超えて保存できない',
  'write-failed': '教室データの書き込みに失敗(Firestore が書き込みを拒否・想定外の例外)',
  'capacity-warning': '教室データが 1 文書の上限(1MiB)に近い(保存は成功)',
  'snapshot-assembly-failed': '分割形式の教室データを組み立てられない(部品が欠ける・合わない・INV-14)',
  'client-too-old': '古い版の画面からの保存を拒否(分割形式を読めない版・§9-7-3)',
  'split-capacity-notice': '分割保存の部品か 1 回の書き込みが上限の 50% を超えた(保存は成功・第 2 段の着手の合図)',
}

/** 何を見れば原因に近づけるか(種類ごと)。メール本文に載せる。 */
export const SAVE_FAILURE_ALERT_HINTS: Readonly<Record<SaveFailureAlertKind, string>> = {
  'stale-version': '同じ教室を 2 つの端末(またはタブ)で開いていないか室長に確かめる。送信版数とサーバー版数の差が 2 以上なら、古いタブで長く作業していた可能性。衝突したタブの内容はその端末の JSON バックアップに退避されている(spec-save-restore §1)。',
  'readback-failed': '関数ログ [saveClassroomSnapshot] と saveAttempts の errorMessage を見る。続けて起きるなら Firestore 側の障害か文書サイズの問題(1MiB)。',
  'data-loss-guard': '端末の教室データが空の状態で保存が走った(読み込み失敗・別教室のデータ混入など)。室長に画面を再読み込みして名簿が出るか確かめてもらう。saveAttempts には記録されない(保存前に止めている)。',
  'snapshot-too-large': '★この教室は直すまで保存が一切通らない。室長には「画面を閉じない・再読み込みしない」を伝える(未保存の内容は端末の失敗時バックアップ JSON にある)。saveAttempts の documentByteLength / capacityRatio で超過量を見る。恒久対策は週単位の分割保存(2026-10-27 日大前校の事故)。',
  'write-failed': 'saveAttempts の errorMessage に Firestore の原因文がある。続けて起きるなら Firestore 側の障害を疑う。容量超過なら種類は snapshot-too-large になる。',
  'capacity-warning': 'まだ保存はできているが、増え続けるといずれ保存が止まる。saveAttempts の capacityRatio の推移を見て、上限到達の前に対策(週単位の分割保存)を出す。この通知は教室ごとに 1 日 1 通。',
  'snapshot-assembly-failed': '★その教室は読み手(自動バックアップ・直前ロールバック・版履歴・保護者ページ・在籍数台帳)が空で扱わず止めている(docs/spec-save-restore.md §9-5-3)。detail の読み手名と理由(missing-part / hash-mismatch / decode-failed / invalid-manifest と部品キー)を見て、目次 classroomSnapshots/{id} が指す snapshotParts/{docId} の有無を Firestore で確かめる。部品が掃除で消えた疑いなら PITR(7 日)で戻す。',
  'client-too-old': 'その端末は段階 A(v1.5.651)より古い画面で分割形式の教室を開いている(空の教室に見えている可能性)。室長に一度ハードリロード(Ctrl+Shift+R)してもらう。未保存の内容は端末の失敗時バックアップ JSON と「開発者へ送る」の控えにある。detail に端末の版。',
  'split-capacity-notice': 'まだ保存はできている。detail の数値(core/board の部品サイズ・書き込み件数/合計)を見て、第 2 段(部品の先書き・specialSessions の講習ごとの分割・docs/spec-save-restore.md §9-3-7 / §9-4-5)を起票する。この通知は教室ごとに 1 日 1 通。',
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
  const isCapacityWarning = input.kind === 'capacity-warning' || input.kind === 'split-capacity-notice'
  const subject = `${isCapacityWarning ? '【容量注意】' : '【保存失敗】'}[コマ表アプリ 監視] ${input.workspaceKey} / ${classroom} / ${label.split('(')[0]}`
  const attemptPath = `workspaces/${input.workspaceKey}/classroomSnapshots/${input.classroomId}/saveAttempts/${input.saveId}`
  const lines = [
    isCapacityWarning
      ? '教室データが保存の上限に近づいたため、アプリ(Cloud Function saveClassroomSnapshot)が自動で送った監視メールです。保存は成功しています(利用者の画面には何も出ていません)。'
      : '保存に失敗したため、アプリ(Cloud Function saveClassroomSnapshot)が自動で送った監視メールです。利用者には画面で失敗の文言が出ています。',
    isCapacityWarning
      ? 'この通知は教室ごとに 1 日 1 通に絞っています。'
      : '同じ教室の失敗は 1 時間に 1 通に絞っています(発生回数は下の値で分かる)。',
    '',
    `会社(workspace): ${input.workspaceKey}`,
    `教室: ${classroom} (${input.classroomId})`,
    `種類: ${label}`,
    `発生時刻: ${toJstLabel(input.occurredAt)} / 保存要求の時刻: ${toJstLabel(input.savedAt)}`,
    `保存 ID: ${input.saveId}`,
    `実行者(UID): ${input.updatedBy || '(不明)'}`,
    `端末: 版 ${input.appVersion || '(不明)'} / ${input.userAgent || '(UA 不明)'}`,
    typeof input.occurrenceCount === 'number' ? `この教室の発生回数(直近の通知以降を含む累計): ${input.occurrenceCount}` : null,
    input.detail ? `詳細: ${input.detail}` : null,
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
  // 区切りの空行は残し、条件で出さない行(null)だけを落とす(L-11)。
  return { subject, text: lines.filter((line): line is string => line !== null).join('\n') }
}
