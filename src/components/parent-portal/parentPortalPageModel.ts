// 保護者ポータル公開ページ(/p/{token})の純ロジック(spec-parent-portal.md §C / §E)。
//
// ParentPortalPage.tsx から React に依存しない判断・整形をここへ切り出し、単体テストで固定する
// (E2E 廃止後はユニットが唯一の自動ゲート。.test.tsx は CI で走らないため .test.ts から検証する)。
// 型は k_contract §1 の API 契約(functions/src/parentPortal.ts の応答)と一致させる。

export type ParentScheduleLessonKind = 'regular' | 'makeup' | 'extra' | 'absent' | 'absent-no-makeup' | 'attended'

export type ParentScheduleLesson = {
  slotNumber: number
  timeLabel: string
  subject: string
  kind: ParentScheduleLessonKind
  // kind==='absent' のとき。null=振替日は調整中(在庫数は出さない・§D-5)。
  makeupDestination?: { dateKey: string; slotNumber: number } | null
  // テンプレ補完由来(=「予定(変更の可能性あり)」・§D-6)。
  isTentative: boolean
}

export type ParentScheduleDayKind = 'closed' | 'lecture-period' | 'board' | 'template' | 'none'

export type ParentScheduleDay = {
  dateKey: string
  weekday: number // 0=日..6=土
  kind: ParentScheduleDayKind
  lectureLabel?: string
  lessons: ParentScheduleLesson[]
}

export type ParentPortalScheduleResponse = {
  studentName: string
  classroomName: string
  snapshotSavedAt: string | null
  today: string
  range: { from: string; to: string }
  bounds: { minFrom: string; maxTo: string }
  days: ParentScheduleDay[]
}

export type ParentScheduleRange = { from: string; to: string }
export type ParentScheduleBounds = { minFrom: string; maxTo: string }

// 「前の4週／次の4週」の移動幅(spec §0 P-1)。
export const PARENT_PORTAL_RANGE_STEP_DAYS = 28
// 送信フォームの上限(spec §E-1・サーバー側 PARENT_MESSAGE_BODY_LIMIT / SENDER_NAME_LIMIT と同値。権威はサーバー)。
export const PARENT_MESSAGE_BODY_LIMIT = 500
export const PARENT_MESSAGE_SENDER_NAME_LIMIT = 30

// 常時表示する注記 3 種(spec §C)。
export const PARENT_PORTAL_NOTES: readonly string[] = [
  '教室で保存された時点の予定です。',
  '予定は変更になることがあります。',
  '変更・欠席のご連絡はこのページ下部からお送りください（お電話でも受け付けます）。',
]

// 利用者向け文言(サーバーの error JSON が無いときのフォールバック。理由を出し分けない・§F)。
export const PARENT_PORTAL_UNAVAILABLE_MESSAGE = 'このリンクは現在ご利用いただけません。教室へお問い合わせください。'
export const PARENT_PORTAL_DISABLED_MESSAGE = '現在ご利用いただけません。'
export const PARENT_PORTAL_INVALID_LINK_MESSAGE = 'このリンクは無効です。教室へお問い合わせください。'
export const PARENT_PORTAL_LOAD_FAILED_MESSAGE = 'データの読み込みに失敗しました。'
export const PARENT_PORTAL_NETWORK_ERROR_MESSAGE = '通信エラーが発生しました。インターネット接続を確認してください。'
export const PARENT_MESSAGE_RATE_LIMIT_MESSAGE = '本日の送信上限に達しました。お急ぎの場合は教室へお電話ください。'
export const PARENT_MESSAGE_SEND_FAILED_MESSAGE = '送信に失敗しました。時間をおいて再度お試しください。'
export const PARENT_MESSAGE_NETWORK_ERROR_MESSAGE = '通信エラーが発生しました。再度お試しください。'
export const PARENT_MESSAGE_SENT_MESSAGE = '受け付けました（返信はこのページには届きません。教室から電話・アプリでご連絡します）'
export const PARENT_SCHEDULE_TENTATIVE_LABEL = '予定（変更の可能性あり）'
export const PARENT_SCHEDULE_NO_LESSON_MESSAGE = '授業の予定はありません'
export const PARENT_SCHEDULE_CLOSED_MESSAGE = 'お休み（教室休講）'
export const PARENT_SCHEDULE_UNKNOWN_MESSAGE = '予定の情報がありません'

const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土'] as const

function isLoopbackOrigin(origin: string) {
  try {
    const url = new URL(origin)
    return url.hostname === 'localhost' || url.hostname === '127.0.0.1'
  } catch {
    return false
  }
}

// SubmissionPage.getSubmissionApiBaseUrl の写し(/api/parent・parentPortalApi)。
// Hosting 上は同一オリジンの rewrite(firebase.json)経由、localhost では cloudfunctions.net 直(cors:true 前提)。
export function getParentPortalApiBaseUrl(origin: string, env: { projectId?: string; region?: string }): string {
  const normalizedOrigin = String(origin ?? '').trim().replace(/\/+$/, '')
  if (!normalizedOrigin) return ''
  if (!isLoopbackOrigin(normalizedOrigin)) {
    return `${normalizedOrigin}/api/parent`
  }
  const projectId = String(env.projectId ?? '').trim()
  const region = String(env.region ?? '').trim() || 'asia-northeast1'
  if (projectId) {
    return `https://${region}-${projectId}.cloudfunctions.net/parentPortalApi`
  }
  return `${normalizedOrigin}/api/parent`
}

// GET/POST の URL。トークンは最後のパスセグメント(関数側 extractTokenFromPath と同じ規約)。
export function buildParentPortalRequestUrl(apiBase: string, token: string, range?: ParentScheduleRange | null): string {
  const base = `${apiBase}/${encodeURIComponent(token)}`
  if (!range) return base
  const query = new URLSearchParams({ from: range.from, to: range.to })
  return `${base}?${query.toString()}`
}

// --- 日付ユーティリティ(UTC 演算で環境 TZ に依存しない) ---

function parseDateKey(dateKey: string): { year: number; month: number; day: number } | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateKey ?? ''))
  if (!match) return null
  const year = Number(match[1])
  const month = Number(match[2])
  const day = Number(match[3])
  if (month < 1 || month > 12 || day < 1 || day > 31) return null
  return { year, month, day }
}

function pad2(value: number) {
  return String(value).padStart(2, '0')
}

function addDays(dateKey: string, days: number): string {
  const parsed = parseDateKey(dateKey)
  if (!parsed) return dateKey
  const ms = Date.UTC(parsed.year, parsed.month - 1, parsed.day) + days * 86_400_000
  const date = new Date(ms)
  return `${date.getUTCFullYear()}-${pad2(date.getUTCMonth() + 1)}-${pad2(date.getUTCDate())}`
}

// '2026-09-14' + 1 → '9月14日(月)'。weekday はサーバー応答の値をそのまま使う(端末 TZ で再計算しない)。
export function formatParentScheduleDayLabel(dateKey: string, weekday: number): string {
  const parsed = parseDateKey(dateKey)
  const weekdayLabel = WEEKDAY_LABELS[weekday] ?? ''
  if (!parsed) return `${dateKey}${weekdayLabel ? `(${weekdayLabel})` : ''}`
  return `${parsed.month}月${parsed.day}日${weekdayLabel ? `(${weekdayLabel})` : ''}`
}

// 振替先などの短い日付表記('9月20日')。
export function formatParentScheduleDateShort(dateKey: string): string {
  const parsed = parseDateKey(dateKey)
  if (!parsed) return dateKey
  return `${parsed.month}月${parsed.day}日`
}

// ISO 時刻を JST(UTC+9)で '9月13日 14:05' に整形する(端末 TZ 非依存)。壊れた値は null。
export function formatJstDateTimeLabel(iso: string | null | undefined): string | null {
  if (!iso) return null
  const ms = Date.parse(iso)
  if (Number.isNaN(ms)) return null
  const jst = new Date(ms + 9 * 3_600_000)
  return `${jst.getUTCMonth() + 1}月${jst.getUTCDate()}日 ${jst.getUTCHours()}:${pad2(jst.getUTCMinutes())}`
}

// ページ上部の「◯月◯日 ◯時◯分 時点」(spec §D-6)。
export function formatParentSnapshotSavedAtLabel(iso: string | null | undefined): string {
  const label = formatJstDateTimeLabel(iso)
  if (!label) return '保存時刻は不明です'
  return `${label} 時点`
}

// 表示期間の移動(前の4週／次の4週)。上限(bounds)に当たったら幅を保ったまま端に寄せる。
export function shiftParentScheduleRange(range: ParentScheduleRange, deltaDays: number, bounds: ParentScheduleBounds): ParentScheduleRange {
  let from = addDays(range.from, deltaDays)
  let to = addDays(range.to, deltaDays)
  if (from < bounds.minFrom) {
    const overshoot = diffDays(bounds.minFrom, from)
    from = bounds.minFrom
    to = addDays(to, overshoot)
  }
  if (to > bounds.maxTo) {
    const overshoot = diffDays(to, bounds.maxTo)
    to = bounds.maxTo
    from = addDays(from, -overshoot)
    if (from < bounds.minFrom) from = bounds.minFrom
  }
  return { from, to }
}

function diffDays(later: string, earlier: string): number {
  const a = parseDateKey(later)
  const b = parseDateKey(earlier)
  if (!a || !b) return 0
  return Math.round((Date.UTC(a.year, a.month - 1, a.day) - Date.UTC(b.year, b.month - 1, b.day)) / 86_400_000)
}

// 移動ボタンを押せるか(端に達していたら無効化する)。
export function canShiftParentScheduleRange(range: ParentScheduleRange, deltaDays: number, bounds: ParentScheduleBounds): boolean {
  const next = shiftParentScheduleRange(range, deltaDays, bounds)
  return next.from !== range.from || next.to !== range.to
}

// 授業 1 行の表示(spec §D-3 の表)。講師名・机番号は受け取っても出さない(型に無い)。
export function describeParentScheduleLesson(lesson: ParentScheduleLesson): { main: string; sub?: string } {
  const subject = String(lesson.subject ?? '').trim() || '授業'
  switch (lesson.kind) {
    case 'regular':
    case 'extra':
      // 通常授業・増コマは科目のみ(種別ラベルなし・P-9)。
      return { main: subject }
    case 'makeup':
      return { main: subject, sub: '振替' }
    case 'attended':
      return { main: subject, sub: '出席済み' }
    case 'absent-no-makeup':
      return { main: 'お休み（振替なし）' }
    case 'absent': {
      const destination = lesson.makeupDestination
      if (destination) {
        return { main: 'お休み', sub: `振替: ${formatParentScheduleDateShort(destination.dateKey)} ${destination.slotNumber}限` }
      }
      return { main: 'お休み', sub: '振替日は調整中です' }
    }
    default:
      return { main: subject }
  }
}

// 授業行が無い日に出す 1 行(null なら授業行を並べる)。
export function describeParentScheduleDayStatus(day: ParentScheduleDay): string | null {
  switch (day.kind) {
    case 'closed':
      return PARENT_SCHEDULE_CLOSED_MESSAGE
    case 'lecture-period': {
      const label = String(day.lectureLabel ?? '').trim()
      return label ? `${label}（別途ご案内）` : '講習期間（別途ご案内）'
    }
    case 'none':
      return PARENT_SCHEDULE_UNKNOWN_MESSAGE
    case 'board':
    case 'template':
      return day.lessons.length === 0 ? PARENT_SCHEDULE_NO_LESSON_MESSAGE : null
    default:
      return PARENT_SCHEDULE_UNKNOWN_MESSAGE
  }
}

// その日に「予定(変更の可能性あり)」バッジを出すか。
export function isParentScheduleDayTentative(day: ParentScheduleDay): boolean {
  return day.lessons.some((lesson) => lesson.isTentative)
}

// 制御文字(改行・タブ以外)を落とす(サーバー側 normalizeParentMessageInput と同じ規則)。
function stripControlCharacters(text: string) {
  // 文字コード直書き(エスケープ)を避け、範囲は fromCharCode で組む: NUL..BS / VT / FF / SO..US / DEL
  const pattern = new RegExp(`[${String.fromCharCode(0)}-${String.fromCharCode(8)}${String.fromCharCode(11)}${String.fromCharCode(12)}${String.fromCharCode(14)}-${String.fromCharCode(31)}${String.fromCharCode(127)}]`, 'g')
  return text.replace(pattern, '')
}

// 送信フォームのクライアント側検証(UX 補助。権威はサーバー・§E-1)。問題なければ null。
export function validateParentMessageInput(input: { body: string; senderName: string }): string | null {
  const body = stripControlCharacters(String(input.body ?? ''))
  if (body.trim().length === 0) return '本文を入力してください。'
  if (body.length > PARENT_MESSAGE_BODY_LIMIT) return `本文は${PARENT_MESSAGE_BODY_LIMIT}字以内で入力してください。`
  const senderName = String(input.senderName ?? '').trim()
  if (senderName.length > PARENT_MESSAGE_SENDER_NAME_LIMIT) return `お名前は${PARENT_MESSAGE_SENDER_NAME_LIMIT}字以内で入力してください。`
  return null
}

function readServerError(serverError: unknown): string | null {
  if (typeof serverError === 'string') {
    const text = serverError.trim()
    return text || null
  }
  if (serverError && typeof serverError === 'object' && 'error' in serverError) {
    const value = (serverError as { error?: unknown }).error
    return typeof value === 'string' && value.trim() ? value.trim() : null
  }
  return null
}

// GET 失敗時の全面エラー文言。サーバー JSON `{ error }` があればそれを優先(利用者向け日本語が来る契約)。
export function resolveParentPortalLoadError(status: number, serverError?: unknown): string {
  const fromServer = readServerError(serverError)
  switch (status) {
    case 400:
      return fromServer ?? PARENT_PORTAL_INVALID_LINK_MESSAGE
    case 403:
      return fromServer ?? PARENT_PORTAL_DISABLED_MESSAGE
    case 404:
    case 410:
      return fromServer ?? PARENT_PORTAL_UNAVAILABLE_MESSAGE
    default:
      return fromServer ?? PARENT_PORTAL_LOAD_FAILED_MESSAGE
  }
}

// POST 失敗時のインライン文言(400=入力・429=回数制限・403/410 は GET と同じ)。
export function resolveParentMessageSendError(status: number, serverError?: unknown): string {
  const fromServer = readServerError(serverError)
  switch (status) {
    case 400:
      return fromServer ?? '入力内容をご確認ください。'
    case 429:
      return fromServer ?? PARENT_MESSAGE_RATE_LIMIT_MESSAGE
    case 403:
      return fromServer ?? PARENT_PORTAL_DISABLED_MESSAGE
    case 404:
    case 410:
      return fromServer ?? PARENT_PORTAL_UNAVAILABLE_MESSAGE
    default:
      return fromServer ?? PARENT_MESSAGE_SEND_FAILED_MESSAGE
  }
}

// GET 応答の最低限の形チェック(壊れた JSON を画面に流さない)。
export function isParentPortalScheduleResponse(value: unknown): value is ParentPortalScheduleResponse {
  if (!value || typeof value !== 'object') return false
  const record = value as Record<string, unknown>
  const range = record.range as Record<string, unknown> | undefined
  const bounds = record.bounds as Record<string, unknown> | undefined
  return typeof record.studentName === 'string'
    && typeof record.classroomName === 'string'
    && typeof record.today === 'string'
    && !!range && typeof range.from === 'string' && typeof range.to === 'string'
    && !!bounds && typeof bounds.minFrom === 'string' && typeof bounds.maxTo === 'string'
    && Array.isArray(record.days)
}
