// 保護者ポータル公開ページ(/p/{token})の純ロジック(spec-parent-portal.md §C / §E)。
//
// ParentPortalPage.tsx から React に依存しない判断・整形をここへ切り出し、単体テストで固定する
// (E2E 廃止後はユニットが唯一の自動ゲート。.test.tsx は CI で走らないため .test.ts から検証する)。
// 型は k_contract §1 の API 契約(functions/src/parentPortal.ts の応答)と一致させる。
//
// ★2026-09-18(オーナー指示): 自由記述の「教室へ連絡」を廃止し、**授業行をタップ → 休み連絡**だけにした。

// ★「この行をタップして休み連絡できるか」はサーバーの POST 検証と**同じ 1 関数**で決める
//   (判定を分散させない。片側だけ条件を足すと「押せるのに 409」「押せないのに送れる」の非対称になる)。
import { isParentLessonAbsenceReportable } from '../../utils/parentSchedule'

export type ParentScheduleLessonKind = 'regular' | 'makeup' | 'extra' | 'absent' | 'absent-no-makeup' | 'attended'

export type ParentScheduleLesson = {
  slotNumber: number
  timeLabel: string
  subject: string
  kind: ParentScheduleLessonKind
  // kind==='absent' のとき。null=振替日は調整中(在庫数は出さない・§D-5)。
  makeupDestination?: { dateKey: string; slotNumber: number } | null
  // 振替コマ(振替・振替を出席済み/振無休にしたもの)の振替元。slotNumber=null は元コマ不明(日付だけ出す)。
  // 旧 functions の応答には無いので省略可。
  makeupOrigin?: { dateKey: string; slotNumber: number | null }
  // テンプレ補完由来(=「予定(変更の可能性あり)」・§D-6)。
  isTentative: boolean
}

// closed=臨時・祝日の休み。授業の無い日・定休曜日は応答に含まれない(オーナー指示 2026-09-14)。
export type ParentScheduleDayKind = 'closed' | 'board' | 'template'

export type ParentScheduleDay = {
  dateKey: string
  weekday: number // 0=日..6=土
  kind: ParentScheduleDayKind
  lessons: ParentScheduleLesson[]
  // closed の日から出ていった振替の振替先(確認リスト k-11)。旧 functions の応答には無いので省略可。
  makeupDestinations?: Array<{ dateKey: string; slotNumber: number }>
}

/** 届いている休み連絡 1 件(GET の応答。旧 functions の応答には無いので省略可)。 */
export type ParentAbsenceNotice = { dateKey: string; slotNumber: number; acknowledged: boolean }

export type ParentPortalScheduleResponse = {
  studentName: string
  classroomName: string
  snapshotSavedAt: string | null
  today: string
  range: { from: string; to: string }
  bounds: { minFrom: string; maxTo: string }
  days: ParentScheduleDay[]
  // その月にこの生徒の講習コマがあったか(講習コマ自体は出ない)。旧 functions の応答には無いので省略可。
  hasLectureLessons?: boolean
  // 表示範囲に届いている休み連絡。旧 functions の応答には無いので省略可(空配列として扱う)。
  absenceNotices?: ParentAbsenceNotice[]
}

export type ParentScheduleRange = { from: string; to: string }
export type ParentScheduleBounds = { minFrom: string; maxTo: string }

// 常時表示する注記 3 種(spec §C)。③は 2026-09-18 に「下部のフォーム」から「授業行をタップ」へ変えた。
export const PARENT_PORTAL_NOTES: readonly string[] = [
  '教室で保存された時点の予定です。',
  '予定は変更になることがあります。',
  'お休みのご連絡は、該当する授業の行をタップしてください（お電話でも受け付けます）。',
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
export const PARENT_SCHEDULE_TENTATIVE_LABEL = '予定（変更の可能性あり）'
// 1 コマ 1 行の一覧では行ごとに短い「予定」印を付け、意味は一覧の上に 1 回だけ出す。
export const PARENT_SCHEDULE_TENTATIVE_LEGEND = '「予定」印の授業は、変更になる可能性があります。'
export const PARENT_SCHEDULE_NO_LESSON_MESSAGE = '授業の予定はありません'
export const PARENT_SCHEDULE_EMPTY_MONTH_MESSAGE = 'この月の授業の予定はありません。'
// 講習だけの月(通常授業の日が無く、講習コマはあった)に出す注記(確認リスト k-4・オーナー回答 2026-09-14)。
export const PARENT_SCHEDULE_LECTURE_ONLY_MONTH_MESSAGE = 'この月は通常授業がありません（講習の日程はこのページには表示されません）。'
export const PARENT_SCHEDULE_CLOSED_MESSAGE = '教室休み'

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

// 表示期間の移動(前の月／次の月・spec §0 P-1)。表示中の月の 1 日〜末日を delta か月ずらす。
// 上限(bounds=今月の前後 1 か月)の外へ出るなら null(=移動しない)。権威はサーバーの丸め。
export function shiftParentScheduleMonth(range: ParentScheduleRange, deltaMonths: number, bounds: ParentScheduleBounds): ParentScheduleRange | null {
  const parsed = parseDateKey(range.from)
  if (!parsed) return null
  const start = new Date(Date.UTC(parsed.year, parsed.month - 1 + deltaMonths, 1))
  const nextStart = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1))
  const from = `${start.getUTCFullYear()}-${pad2(start.getUTCMonth() + 1)}-01`
  const to = addDays(`${nextStart.getUTCFullYear()}-${pad2(nextStart.getUTCMonth() + 1)}-01`, -1)
  if (from < bounds.minFrom || to > bounds.maxTo) return null
  if (from === range.from && to === range.to) return null
  return { from, to }
}

// 移動ボタンを押せるか(端に達していたら無効化する)。
export function canShiftParentScheduleMonth(range: ParentScheduleRange, deltaMonths: number, bounds: ParentScheduleBounds): boolean {
  return shiftParentScheduleMonth(range, deltaMonths, bounds) !== null
}

// 表示中の月の見出し('2026-09-01' → '2026年9月')。
export function formatParentScheduleMonthLabel(dateKey: string): string {
  const parsed = parseDateKey(dateKey)
  if (!parsed) return dateKey
  return `${parsed.year}年${parsed.month}月`
}

// 振替元/振替先の「月日コマ」表記('9/21 1限'。元コマ不明なら日付だけ)。
// 1 コマ 1 行に収めるため月日は「9/21」の短い形にする(確認リスト k-11 2026-09-14「振替日付も含めて1行表示」)。
export function formatParentScheduleLinkedSlot(link: { dateKey: string; slotNumber: number | null }): string {
  const parsed = parseDateKey(link.dateKey)
  const date = parsed ? `${parsed.month}/${parsed.day}` : link.dateKey
  return typeof link.slotNumber === 'number' && Number.isInteger(link.slotNumber) ? `${date} ${link.slotNumber}限` : date
}

// 授業 1 行の表示(spec §D-3 の表)。講師名・机番号は受け取っても出さない(型に無い)。
// 振替元に振替先、振替先に振替元を「月日コマ」で出す(確認リスト その他 2026-09-14)。
// 補足は 1 行に収まる短い言い回しにする(k-11): 休み「9/30 5限に振替」／振替「9/23 5限の振替」／振無休「9/19 2限分 振替なし」。
export function describeParentScheduleLesson(lesson: ParentScheduleLesson): { main: string; sub?: string } {
  const subject = String(lesson.subject ?? '').trim() || '授業'
  const originSlot = lesson.makeupOrigin ? formatParentScheduleLinkedSlot(lesson.makeupOrigin) : ''
  const originText = originSlot ? `${originSlot}の振替` : ''
  switch (lesson.kind) {
    case 'regular':
    case 'extra':
      // 通常授業・増コマは科目のみ(種別ラベルなし・P-9)。
      return { main: subject }
    case 'makeup':
      return { main: subject, sub: originText || '振替' }
    case 'attended':
      return { main: subject, sub: originText ? `出席（${originText}）` : '出席済み' }
    case 'absent-no-makeup':
      return { main: 'お休み', sub: originSlot ? `${originSlot}分 振替なし` : '振替なし' }
    case 'absent': {
      const destination = lesson.makeupDestination
      if (destination) {
        return { main: 'お休み', sub: `${formatParentScheduleLinkedSlot(destination)}に振替` }
      }
      return { main: 'お休み', sub: '振替日は調整中' }
    }
    default:
      return { main: subject }
  }
}

// 授業行の代わりに出す 1 行(null なら授業行を並べる)。
// 講習期間の「別途ご案内」は廃止(講習は講習提出QRで案内し、このページは通常授業だけ・オーナー指示 2026-09-14)。
export function describeParentScheduleDayStatus(day: ParentScheduleDay): string | null {
  if (day.kind === 'closed') return PARENT_SCHEDULE_CLOSED_MESSAGE
  return day.lessons.length === 0 ? PARENT_SCHEDULE_NO_LESSON_MESSAGE : null
}

/** そのコマに休み連絡が届いているか(バッジの種別)。 */
export type ParentAbsenceStatus = 'none' | 'reported' | 'acknowledged'

// 一覧は 1 コマ 1 行(確認リスト その他 2026-09-14「スクロール量が短くなるように」)。
// 日付は同じ日の先頭行だけに出し、教室休み・授業の無い日は 1 行にまとめる。
export type ParentScheduleRow = {
  key: string
  dateKey: string
  weekday: number
  // 同じ日の 2 行目以降は false(日付欄を空ける)。
  isFirstOfDay: boolean
  isToday: boolean
  // 'closed'=教室休み / 'status'=授業の無い日 / 'lesson'=授業 1 コマ
  rowKind: 'closed' | 'status' | 'lesson'
  slotLabel: string
  timeLabel: string
  main: string
  sub?: string
  lessonKind?: ParentScheduleLessonKind
  isTentative: boolean
  /** 授業行だけ。休み連絡の対象を特定するのに使う。 */
  slotNumber?: number
  /** 科目(休み連絡の確認モーダルに出す元の値。main は「お休み」等に化けるので別に持つ)。 */
  subject?: string
  /** タップして休み連絡できるか(連絡可能なコマ **かつ** まだ連絡していない)。 */
  canReportAbsence: boolean
  /** 届いている休み連絡の状態(バッジ)。 */
  absenceStatus: ParentAbsenceStatus
}

// '2026-09-14' + 1 → '14日(月)'(月は見出しに出ているので省く)。
export function formatParentScheduleRowDateLabel(dateKey: string, weekday: number): string {
  const parsed = parseDateKey(dateKey)
  const weekdayLabel = WEEKDAY_LABELS[weekday] ?? ''
  const head = parsed ? `${parsed.day}日` : dateKey
  return `${head}${weekdayLabel ? `(${weekdayLabel})` : ''}`
}

// 時限の開始時刻だけ('19:40-21:10' → '19:40')。形が違えばそのまま。
function formatLessonStartTime(timeLabel: string): string {
  const text = String(timeLabel ?? '').trim()
  const matched = /^(\d{1,2}:\d{2})\s*[-〜~]/.exec(text)
  return matched ? matched[1] : text
}

/** そのコマに届いている休み連絡の状態を引く(日付＋限の一致)。 */
export function resolveParentAbsenceStatus(
  notices: readonly ParentAbsenceNotice[],
  dateKey: string,
  slotNumber: number,
): ParentAbsenceStatus {
  const notice = notices.find((entry) => entry.dateKey === dateKey && entry.slotNumber === slotNumber)
  if (!notice) return 'none'
  return notice.acknowledged ? 'acknowledged' : 'reported'
}

export function buildParentScheduleRows(
  days: readonly ParentScheduleDay[],
  today: string,
  notices: readonly ParentAbsenceNotice[] = [],
): ParentScheduleRow[] {
  const rows: ParentScheduleRow[] = []
  for (const day of days) {
    const isToday = day.dateKey === today
    const status = describeParentScheduleDayStatus(day)
    if (status) {
      rows.push({
        key: `${day.dateKey}-${day.kind}`,
        dateKey: day.dateKey,
        weekday: day.weekday,
        isFirstOfDay: true,
        isToday,
        rowKind: day.kind === 'closed' ? 'closed' : 'status',
        slotLabel: '',
        timeLabel: '',
        main: status,
        ...(day.kind === 'closed' && day.makeupDestinations && day.makeupDestinations.length > 0
          ? { sub: `${day.makeupDestinations.map((destination) => formatParentScheduleLinkedSlot(destination)).join('・')}に振替` }
          : {}),
        isTentative: false,
        canReportAbsence: false,
        absenceStatus: 'none',
      })
      continue
    }
    day.lessons.forEach((lesson, index) => {
      const described = describeParentScheduleLesson(lesson)
      const absenceStatus = resolveParentAbsenceStatus(notices, day.dateKey, lesson.slotNumber)
      rows.push({
        key: `${day.dateKey}-${lesson.slotNumber}-${lesson.kind}-${index}`,
        dateKey: day.dateKey,
        weekday: day.weekday,
        isFirstOfDay: index === 0,
        isToday,
        rowKind: 'lesson',
        slotLabel: `${lesson.slotNumber}限`,
        timeLabel: formatLessonStartTime(lesson.timeLabel),
        main: described.main,
        ...(described.sub ? { sub: described.sub } : {}),
        lessonKind: lesson.kind,
        isTentative: lesson.isTentative,
        slotNumber: lesson.slotNumber,
        subject: String(lesson.subject ?? '').trim(),
        // 連絡済みの行はタップ不可(二重連絡の 409 を画面で見せない)。判定の権威は共有純関数。
        canReportAbsence: absenceStatus === 'none' && isParentLessonAbsenceReportable(lesson.kind, day.dateKey, today),
        absenceStatus,
      })
    })
  }
  return rows
}

// ---------------------------------------------------------------------------
// 休み連絡(2026-09-18)
// ---------------------------------------------------------------------------

export const PARENT_ABSENCE_BADGE_REPORTED = '休み連絡済'
export const PARENT_ABSENCE_BADGE_ACKNOWLEDGED = '教室確認済'
/** タップできる行が 1 つでもあるときだけ一覧の上に出す説明。 */
export const PARENT_ABSENCE_LIST_HINT = '授業の行をタップすると、お休みの連絡ができます。'
export const PARENT_ABSENCE_CONFIRM_QUESTION = 'このコマをお休みします。よろしいですか?'
export const PARENT_ABSENCE_CONFIRM_SUBMIT_LABEL = 'お休みを連絡する'
export const PARENT_ABSENCE_CONFIRM_CANCEL_LABEL = 'やめる'
export const PARENT_ABSENCE_CONFIRM_NOTE_ACKNOWLEDGE = `教室が確認すると、このページに「${PARENT_ABSENCE_BADGE_ACKNOWLEDGED}」と表示されます。`
export const PARENT_ABSENCE_CONFIRM_NOTE_CANCEL = '取り消し・変更はお電話でご連絡ください。'
/** 当日のコマだけ足す注意(授業までに確認が間に合わない可能性がある)。 */
export const PARENT_ABSENCE_CONFIRM_NOTE_SAME_DAY = `当日のご連絡です。授業までに「${PARENT_ABSENCE_BADGE_ACKNOWLEDGED}」にならない場合は、お電話でもご連絡ください。`
export const PARENT_ABSENCE_SENT_MESSAGE = 'お休みの連絡を送りました。'
export const PARENT_ABSENCE_CONFLICT_MESSAGE = 'このコマはお休みの連絡ができません。ページを読み込み直して最新の予定をご確認ください。'

/** バッジの文言(none のときは出さない)。 */
export function describeParentAbsenceBadge(status: ParentAbsenceStatus): string | null {
  if (status === 'acknowledged') return PARENT_ABSENCE_BADGE_ACKNOWLEDGED
  if (status === 'reported') return PARENT_ABSENCE_BADGE_REPORTED
  return null
}

/** 確認モーダルの対象コマ(POST の body もここから作る)。 */
export type ParentAbsenceTarget = {
  dateKey: string
  weekday: number
  slotNumber: number
  timeLabel: string
  subject: string
}

/** タップされた行 → モーダルの対象。連絡できない行は null(押せない行が押されても送らない)。 */
export function toParentAbsenceTarget(row: ParentScheduleRow): ParentAbsenceTarget | null {
  if (!row.canReportAbsence || typeof row.slotNumber !== 'number') return null
  return {
    dateKey: row.dateKey,
    weekday: row.weekday,
    slotNumber: row.slotNumber,
    timeLabel: row.timeLabel,
    subject: row.subject ?? '',
  }
}

/** 対象コマの 1 行表記('9月20日(土) 3限 16:20〜 英')。科目が空でも見出しが崩れないようにする。 */
export function formatParentAbsenceTargetLabel(target: ParentAbsenceTarget): string {
  const parts = [
    formatParentScheduleDayLabel(target.dateKey, target.weekday),
    `${target.slotNumber}限`,
    target.timeLabel ? `${target.timeLabel}〜` : '',
    target.subject,
  ]
  return parts.filter((part) => part).join(' ')
}

/** 行の読み上げ用ラベル(内部 ID は出さない)。 */
export function buildParentAbsenceRowAriaLabel(row: ParentScheduleRow): string | null {
  const target = toParentAbsenceTarget(row)
  if (!target) return null
  return `${formatParentAbsenceTargetLabel(target)} のお休みを連絡する`
}

/** 確認モーダルの文言。当日のコマだけ注意を 1 つ足す。 */
export function describeParentAbsenceConfirm(target: ParentAbsenceTarget, today: string): { target: string; question: string; notes: string[] } {
  const notes = [PARENT_ABSENCE_CONFIRM_NOTE_ACKNOWLEDGE, PARENT_ABSENCE_CONFIRM_NOTE_CANCEL]
  if (target.dateKey === today) notes.push(PARENT_ABSENCE_CONFIRM_NOTE_SAME_DAY)
  return { target: formatParentAbsenceTargetLabel(target), question: PARENT_ABSENCE_CONFIRM_QUESTION, notes }
}

// その日に「予定(変更の可能性あり)」バッジを出すか。
export function isParentScheduleDayTentative(day: ParentScheduleDay): boolean {
  return day.lessons.some((lesson) => lesson.isTentative)
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

// 休み連絡の POST 失敗時にモーダル内へ出す文言(409=連絡できないコマ/二重連絡・429=回数制限・
// 403/410 は GET と同じ)。★サーバーの `{ error }` を最優先する(理由の言い分けはサーバーが持つ)。
export function resolveParentAbsenceSendError(status: number, serverError?: unknown): string {
  const fromServer = readServerError(serverError)
  switch (status) {
    case 400:
      return fromServer ?? PARENT_ABSENCE_CONFLICT_MESSAGE
    case 409:
      return fromServer ?? PARENT_ABSENCE_CONFLICT_MESSAGE
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

/**
 * 409 のときは画面の日程が古い(教室側が先に処理した / 別端末から送った)。日程を取り直して
 * バッジ・タップ可否を最新にする(取り直さないと「押せるのに必ず失敗する行」が残る)。
 */
export function shouldReloadParentScheduleAfterSendError(status: number): boolean {
  return status === 409
}

// 一覧の下に出す一言。講習だけの月は講習の注記、授業も休みも無い月は従来どおりの「予定はありません」。
// 講習が無く臨時休みだけの月は何も出さない(オーナー回答 2026-09-14「今のまま」)。
export function resolveParentScheduleMonthNotice(schedule: Pick<ParentPortalScheduleResponse, 'days' | 'hasLectureLessons'>): string | null {
  const hasLessonDay = schedule.days.some((day) => day.kind !== 'closed')
  if (!hasLessonDay && schedule.hasLectureLessons === true) return PARENT_SCHEDULE_LECTURE_ONLY_MONTH_MESSAGE
  if (schedule.days.length === 0) return PARENT_SCHEDULE_EMPTY_MONTH_MESSAGE
  return null
}

/**
 * 応答の `absenceNotices` を読む。**欠落は空配列**として扱う(Hosting が先に出て旧 functions が
 * 応答している間でもページが壊れない・k-4 の hasLectureLessons と同じ作法)。壊れた行は捨てる。
 */
export function readParentAbsenceNotices(value: unknown): ParentAbsenceNotice[] {
  if (!value || typeof value !== 'object') return []
  const raw = (value as { absenceNotices?: unknown }).absenceNotices
  if (!Array.isArray(raw)) return []
  const notices: ParentAbsenceNotice[] = []
  for (const candidate of raw) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const entry = candidate as Record<string, unknown>
    const dateKey = typeof entry.dateKey === 'string' ? entry.dateKey : ''
    const slotNumber = typeof entry.slotNumber === 'number' && Number.isInteger(entry.slotNumber) ? entry.slotNumber : null
    if (!dateKey || slotNumber === null) continue
    notices.push({ dateKey, slotNumber, acknowledged: entry.acknowledged === true })
  }
  return notices
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
