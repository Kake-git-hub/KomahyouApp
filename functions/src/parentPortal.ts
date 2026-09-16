// 保護者向け固定QR(生徒別ポータル)のサーバー側純ロジック。docs/spec-parent-portal.md(正本)の
// §B(トークン)/§E(連絡)/§F(在籍判定)/§G-2(関数側の検証順)/§H(機能フラグ)をここへ集約する。
//
// index.ts 側は Firestore の読み書き(deps)を差し込むだけにし、検証順・文言・回数制限の判定・
// 文書の形はすべてこのモジュールで決める(index.ts から新規 export しない = Firebase が export を
// そのまま関数としてデプロイするため。テストは firebase 非依存でこのファイルだけを回す)。
//
// ⚠️ 応答・ログ・文書に「講師名・机番号・他生徒・在庫数・トークン全文」を出さない(§C/§G-1)。
//   トークンはログ用に先頭 6 文字(tokenPrefix)だけ持つ。
// ⚠️ 既存の lectureSubmissionApi(トークン長しか見ない・教室所有権もレート制限も無い)は無改変(§J-1)。
//   この API は最初から「トークン doc の classroomId を権威にし、在籍・フラグ・回数制限まで関数側で検証」する。
import { createHash, randomBytes } from 'node:crypto'

import { isDevelopmentClassroomIdentity } from './developmentClassroomIdentity'

// ───────────────────────────────────────────────────────────────────────────
// トークン(§B-1)
// ───────────────────────────────────────────────────────────────────────────

/** URL の最後のパスセグメントとして受け付ける形。`/s/{token}` と同じ文字集合・同じ長さ幅(16〜64)。 */
export const PARENT_PORTAL_TOKEN_PATTERN = /^[A-Za-z0-9_-]{16,64}$/

/** 発行するトークンの乱数バイト数。24 バイトを base64url にすると 32 文字(パディング無し)になる。 */
export const PARENT_PORTAL_TOKEN_BYTES = 24

/** ログに残してよいトークンの先頭文字数(§G-1)。 */
export const PARENT_PORTAL_TOKEN_PREFIX_LENGTH = 6

/**
 * 暗号論的乱数のトークンを 1 本作る(32 文字・`[A-Za-z0-9_-]`)。
 * `random` はテストで決定的な値を差し込むための注入口(既定は node:crypto の randomBytes)。
 */
export function generateStudentPortalToken(random: (byteLength: number) => Buffer = randomBytes): string {
  return random(PARENT_PORTAL_TOKEN_BYTES).toString('base64url')
}

export function isValidParentPortalToken(token: unknown): token is string {
  return typeof token === 'string' && PARENT_PORTAL_TOKEN_PATTERN.test(token)
}

/** ログ用の先頭 6 文字。全文を残さない(§G-1)。 */
export function toParentPortalTokenPrefix(token: unknown): string {
  return typeof token === 'string' ? token.slice(0, PARENT_PORTAL_TOKEN_PREFIX_LENGTH) : ''
}

/** 生徒 1 名＝有効トークン 1 本を保証する索引 `studentPortalTokenOwners/{classroomId}__{studentId}` の ID。 */
export function buildStudentPortalOwnerId(classroomId: string, studentId: string): string {
  return `${classroomId}__${studentId}`
}

export type StudentPortalTokenRevokedReason = 'reissue' | 'manual' | 'studentDeleted'

/** 権威 `studentPortalTokens/{token}`(§B-1)。クライアントからは read/write 不可。 */
export type StudentPortalTokenDoc = {
  workspaceKey: string
  classroomId: string
  studentId: string
  createdAt: string
  createdByUid: string
  revokedAt: string | null
  revokedReason?: StudentPortalTokenRevokedReason
}

/** 索引 `studentPortalTokenOwners/{classroomId}__{studentId}`。 */
export type StudentPortalOwnerDoc = {
  workspaceKey: string
  classroomId: string
  studentId: string
  token: string
  updatedAt: string
}

/** Firestore から読んだ値を「有効なトークン doc」として扱えるかを緩く判定する(欠損・型違いは無効扱い)。 */
export function readStudentPortalTokenDoc(raw: unknown): StudentPortalTokenDoc | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const data = raw as Record<string, unknown>
  const workspaceKey = typeof data.workspaceKey === 'string' ? data.workspaceKey : ''
  const classroomId = typeof data.classroomId === 'string' ? data.classroomId : ''
  const studentId = typeof data.studentId === 'string' ? data.studentId : ''
  if (!workspaceKey || !classroomId || !studentId) return null
  const revokedReason = data.revokedReason
  return {
    workspaceKey,
    classroomId,
    studentId,
    createdAt: typeof data.createdAt === 'string' ? data.createdAt : '',
    createdByUid: typeof data.createdByUid === 'string' ? data.createdByUid : '',
    revokedAt: typeof data.revokedAt === 'string' && data.revokedAt ? data.revokedAt : null,
    ...(revokedReason === 'reissue' || revokedReason === 'manual' || revokedReason === 'studentDeleted' ? { revokedReason } : {}),
  }
}

export function isStudentPortalTokenActive(doc: StudentPortalTokenDoc | null | undefined): doc is StudentPortalTokenDoc {
  return doc !== null && typeof doc !== 'undefined' && doc.revokedAt === null
}

// ───────────────────────────────────────────────────────────────────────────
// 機能フラグ(§H)。クライアント src/utils/featureRollout.ts の parentPortalQr = 'development-only' の鏡像。
// ───────────────────────────────────────────────────────────────────────────

/** staging プロジェクトでは全教室で有効(実機検証用。本番教室のトークンは staging に存在しない)。 */
export const PARENT_PORTAL_STAGING_PROJECT_ID = 'komahyouapp-staging'

export type ParentPortalClassroomIdentity = {
  /** 会社 = workspace のキー。教室IDは会社ごとに登録台帳で引くので必須(2026-09-16)。 */
  workspaceKey: string | null | undefined
  id: string | null | undefined
  projectId: string | null | undefined
}

/**
 * 保護者ポータルがその教室で有効か(第 1 段 = 開発用教室限定・spec §H / k_contract §0)。
 * ⚠️ 昇格するときはクライアント側 `featureRolloutRegistry.parentPortalQr` と**同時に**変える
 *   (サーバーだけ ON にしてもボタンが出ず、クライアントだけ ON にしても API が 403 を返す)。
 * ⚠️ 述語はクライアントの `staging-environment` スコープ
 *   (`isStagingEnvironment() || isDevelopmentClassroom({ id }, workspaceKey)`)と**同一**にしてある。
 *   判定の権威は登録台帳 `src/utils/developmentClassroomRegistry.ts`(の複製)1 か所だけで、
 *   ここに教室ID の直書きを足さない: 片側だけ広いと「QR は出ないのに API は答える」(またはその逆)の
 *   非対称になる。台帳から外せば両側同時に無効化される(fail-closed)。
 *   ★2026-09-16 以前は教室名「開発用教室」でも有効だったが、他社が同名教室を作ると誤って有効になるため廃止。
 */
export function isParentPortalEnabledForClassroom(identity: ParentPortalClassroomIdentity): boolean {
  return isDevelopmentClassroomIdentity(identity.workspaceKey, identity.id)
    || (identity.projectId ?? '').trim() === PARENT_PORTAL_STAGING_PROJECT_ID
}

// ───────────────────────────────────────────────────────────────────────────
// 連絡本文の正規化(§E-1・P-3)
// ───────────────────────────────────────────────────────────────────────────

export const PARENT_MESSAGE_BODY_LIMIT = 500
export const PARENT_MESSAGE_SENDER_NAME_LIMIT = 30

export const PARENT_MESSAGE_ERROR_INVALID_INPUT = '入力の形式が正しくありません。'
export const PARENT_MESSAGE_ERROR_BODY_EMPTY = '本文を入力してください。'
export const PARENT_MESSAGE_ERROR_BODY_TOO_LONG = `本文は${PARENT_MESSAGE_BODY_LIMIT}文字以内で入力してください。`
export const PARENT_MESSAGE_ERROR_SENDER_NAME_TOO_LONG = `お名前は${PARENT_MESSAGE_SENDER_NAME_LIMIT}文字以内で入力してください。`

// 見た目が空の連絡を弾くため、ゼロ幅・不可視の書式文字も落とす(U+200B〜U+200F・U+2028/2029・
// U+2060・U+FEFF)。これを残すと trim() を通り抜けて「本文 1 文字」の空連絡で 1 日 5 件の枠を埋められる。
const INVISIBLE_FORMAT_CHARS = /[\u200B-\u200F\u2028\u2029\u2060\uFEFF]/g

// C0 制御文字(改行 \n・タブ \t を除く)・DEL・C1 制御文字。\r は CRLF 正規化のあとに残った分を落とす。
// eslint-disable-next-line no-control-regex
const CONTROL_CHARS_EXCEPT_NEWLINE_TAB = /[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F-\u009F]/g
// eslint-disable-next-line no-control-regex
const ALL_CONTROL_CHARS = /[\u0000-\u001F\u007F-\u009F]/g

/** 改行・タブ以外の制御文字とゼロ幅文字を除去する(本文用)。CRLF / CR は LF に寄せる。 */
export function stripControlCharactersExceptNewlineAndTab(text: string): string {
  return text.replace(/\r\n?/g, '\n').replace(CONTROL_CHARS_EXCEPT_NEWLINE_TAB, '').replace(INVISIBLE_FORMAT_CHARS, '')
}

/** すべての制御文字とゼロ幅文字を除去する(送信者名など 1 行の値用)。 */
export function stripAllControlCharacters(text: string): string {
  return text.replace(ALL_CONTROL_CHARS, '').replace(INVISIBLE_FORMAT_CHARS, '')
}

/** 文字数はコードポイントで数える(サロゲートペアの漢字・絵文字を 2 文字に数えない)。 */
export function countCharacters(text: string): number {
  return Array.from(text).length
}

// URL らしさ(室長側の注意表示用・§E-1 containsUrl)。スキーム付き、www.、または「英数字.英字TLD/」の並び。
const URL_LIKE_PATTERN = /(?:https?:\/\/|ftp:\/\/|www\.)[^\s]+|\b[a-z0-9-]+(?:\.[a-z0-9-]+)+\.(?:com|net|org|jp|co|io|info|biz|me|app|dev|xyz|link|site|online|club|shop|tokyo)\b(?:\/[^\s]*)?/i

export function containsUrlLike(text: string): boolean {
  return URL_LIKE_PATTERN.test(text)
}

export type NormalizedParentMessageInput =
  | { ok: true; body: string; senderName: string; containsUrl: boolean }
  | { ok: false; error: string }

/**
 * POST body `{ body: string; senderName?: string }` を検証・正規化する(すべてサーバー側が権威。§E-1)。
 * - body: 制御文字(改行・タブ以外)を除いたうえで前後の空白を落とし、1〜500 字。0 字・制御文字のみ・501 字超は不可。
 * - senderName: 任意。制御文字を除き前後の空白を落として 0〜30 字。文字列以外(数値等)は不可。
 * 文字列で届いた body(JSON 文字列)は一度だけ JSON.parse を試みる(Content-Type 違いの保険)。
 */
export function normalizeParentMessageInput(raw: unknown): NormalizedParentMessageInput {
  let input: unknown = raw
  if (typeof input === 'string') {
    try {
      input = JSON.parse(input)
    } catch {
      return { ok: false, error: PARENT_MESSAGE_ERROR_INVALID_INPUT }
    }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    return { ok: false, error: PARENT_MESSAGE_ERROR_INVALID_INPUT }
  }
  const data = input as Record<string, unknown>
  if (typeof data.body !== 'string') {
    return { ok: false, error: PARENT_MESSAGE_ERROR_BODY_EMPTY }
  }
  const body = stripControlCharactersExceptNewlineAndTab(data.body).trim()
  if (body.length === 0) {
    return { ok: false, error: PARENT_MESSAGE_ERROR_BODY_EMPTY }
  }
  if (countCharacters(body) > PARENT_MESSAGE_BODY_LIMIT) {
    return { ok: false, error: PARENT_MESSAGE_ERROR_BODY_TOO_LONG }
  }

  const rawSenderName = data.senderName
  if (typeof rawSenderName !== 'undefined' && rawSenderName !== null && typeof rawSenderName !== 'string') {
    return { ok: false, error: PARENT_MESSAGE_ERROR_INVALID_INPUT }
  }
  const senderName = typeof rawSenderName === 'string' ? stripAllControlCharacters(rawSenderName).trim() : ''
  if (countCharacters(senderName) > PARENT_MESSAGE_SENDER_NAME_LIMIT) {
    return { ok: false, error: PARENT_MESSAGE_ERROR_SENDER_NAME_TOO_LONG }
  }

  return { ok: true, body, senderName, containsUrl: containsUrlLike(body) }
}

// ───────────────────────────────────────────────────────────────────────────
// 回数制限(§E-1・P-4)。カウンタ文書は classroomSnapshots/{classroomId}/parentPortalRateLimits/{key}。
// 全体 1 分 30 件は未実装(maxInstances で代替。k_contract §0)。
// ───────────────────────────────────────────────────────────────────────────

export const PARENT_MESSAGE_DAILY_LIMIT_PER_TOKEN = 5
export const PARENT_MESSAGE_HOURLY_LIMIT_PER_CLASSROOM = 60
export const PARENT_MESSAGE_RATE_LIMIT_ERROR = '本日の送信上限に達しました。お急ぎの場合は教室へお電話ください。'

const HOUR_IN_MS = 60 * 60 * 1000
const JST_OFFSET_IN_MS = 9 * HOUR_IN_MS

/** ISO 時刻を JST の `YYYY-MM-DD` と `YYYY-MM-DDTHH` に分ける(回数制限の日・時の境界は JST。P-4)。 */
export function resolveJstRateLimitPeriods(nowIso: string): { dayKey: string; hourKey: string } {
  const parsed = new Date(nowIso)
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`invalid ISO datetime: ${nowIso}`)
  }
  const jst = new Date(parsed.getTime() + JST_OFFSET_IN_MS)
  const year = jst.getUTCFullYear()
  const month = `${jst.getUTCMonth() + 1}`.padStart(2, '0')
  const day = `${jst.getUTCDate()}`.padStart(2, '0')
  const hour = `${jst.getUTCHours()}`.padStart(2, '0')
  const dayKey = `${year}-${month}-${day}`
  return { dayKey, hourKey: `${dayKey}T${hour}` }
}

export type ParentMessageRateLimitKeys = {
  /** `t{トークンのSHA-256先頭32桁}__YYYY-MM-DD`(トークン × JST 日)。 */
  tokenDayKey: string
  /** `classroom__YYYY-MM-DDTHH`(教室 × JST 時。教室はコレクションのパスで決まる)。 */
  classroomHourKey: string
}

/**
 * カウンタ文書 ID に使うトークンの指紋。**トークン全文を文書 ID にしない**(§G-1)。
 * 文書 ID はパスの一部なので、Firestore の例外メッセージ(競合・不正引数など)に載って
 * `logger.error` へ流れ、「ログに残すのは先頭 6 文字だけ」という取り決めが破れる。
 */
export function buildParentPortalTokenFingerprint(token: string): string {
  return createHash('sha256').update(token, 'utf8').digest('hex').slice(0, 32)
}

export function buildParentMessageRateLimitKeys(token: string, nowIso: string): ParentMessageRateLimitKeys {
  const { dayKey, hourKey } = resolveJstRateLimitPeriods(nowIso)
  return { tokenDayKey: `t${buildParentPortalTokenFingerprint(token)}__${dayKey}`, classroomHourKey: `classroom__${hourKey}` }
}

export type ParentMessageRateLimitCounts = {
  /** **加算前**の値(この送信を含まない = これまでに保存できた件数)。 */
  tokenCountToday: number
  classroomCountThisHour: number
}

/**
 * 加算**前**のカウントで判定する: 既に 5 件保存済みなら 6 件目は拒否(教室は 60 件)。
 *
 * ★拒否した試行はカウントに含めない(`resolveParentMessageRateLimitOutcome` が書き込まない)。
 *   含めていた旧実装では、1 本の漏洩QRから 61 回連打すると教室×時カウンタが上限を超え、
 *   **同じ教室の他の保護者が 1 時間送れなくなる**(毎正時に撃ち直せば無期限)。加えて拒否されている間も
 *   カウンタ文書への書き込み課金が止まらなかった。上限に達したトークン自身は、その日の枠が
 *   空かないので連打でも通らない(カウンタを増やさなくても既に上限値のまま)。
 */
export function decideParentMessageRateLimit(counts: ParentMessageRateLimitCounts): { allowed: boolean; error?: string } {
  if (counts.tokenCountToday >= PARENT_MESSAGE_DAILY_LIMIT_PER_TOKEN) {
    return { allowed: false, error: PARENT_MESSAGE_RATE_LIMIT_ERROR }
  }
  if (counts.classroomCountThisHour >= PARENT_MESSAGE_HOURLY_LIMIT_PER_CLASSROOM) {
    return { allowed: false, error: PARENT_MESSAGE_RATE_LIMIT_ERROR }
  }
  return { allowed: true }
}

/** カウンタ文書 `{ count, createdAt, updatedAt }`。createdAt は retention(7 日)の掃除キー。 */
export type ParentPortalRateLimitCounterDoc = {
  count: number
  createdAt: string
  updatedAt: string
}

/** 既存カウンタ(無ければ null)を 1 加算した新しい文書を返す。createdAt は初回の値を据え置く。 */
export function incrementRateLimitCounterDoc(existing: unknown, nowIso: string): ParentPortalRateLimitCounterDoc {
  const data = existing && typeof existing === 'object' && !Array.isArray(existing) ? (existing as Record<string, unknown>) : null
  const previousCount = readRateLimitCount(data)
  const createdAt = typeof data?.createdAt === 'string' && data.createdAt ? data.createdAt : nowIso
  return { count: previousCount + 1, createdAt, updatedAt: nowIso }
}

function readRateLimitCount(data: Record<string, unknown> | null): number {
  return typeof data?.count === 'number' && Number.isFinite(data.count) && data.count > 0 ? Math.trunc(data.count) : 0
}

export type ParentMessageRateLimitOutcome = {
  allowed: boolean
  error?: string
  /** 適用すべき書き込み。**拒否のときは null**(1 件も書かない)。 */
  writes: { token: ParentPortalRateLimitCounterDoc; classroom: ParentPortalRateLimitCounterDoc } | null
}

/**
 * 「読む → 判定する → 許可のときだけ加算する」をトランザクション内で使える純関数にしたもの。
 * index.ts は読んだ 2 文書をここへ渡し、`writes` が返ったときだけ set する。
 * これで拒否された試行がカウンタ(＝他の保護者の枠)と書き込み課金を消費しない。
 */
export function resolveParentMessageRateLimitOutcome(input: {
  tokenCounter: unknown
  classroomCounter: unknown
  nowIso: string
}): ParentMessageRateLimitOutcome {
  const tokenData = input.tokenCounter && typeof input.tokenCounter === 'object' && !Array.isArray(input.tokenCounter)
    ? (input.tokenCounter as Record<string, unknown>)
    : null
  const classroomData = input.classroomCounter && typeof input.classroomCounter === 'object' && !Array.isArray(input.classroomCounter)
    ? (input.classroomCounter as Record<string, unknown>)
    : null
  const decision = decideParentMessageRateLimit({
    tokenCountToday: readRateLimitCount(tokenData),
    classroomCountThisHour: readRateLimitCount(classroomData),
  })
  if (!decision.allowed) return { allowed: false, error: decision.error, writes: null }
  return {
    allowed: true,
    writes: {
      token: incrementRateLimitCounterDoc(tokenData, input.nowIso),
      classroom: incrementRateLimitCounterDoc(classroomData, input.nowIso),
    },
  }
}

// ───────────────────────────────────────────────────────────────────────────
// GET のスロットル(§0-2・F-2)。GET は Firestore へ書かないので回数制限も「書かない」形にする:
// 関数インスタンスのメモリ上でトークン指紋ごとに件数を数える。1 GET = トークン doc + 教室 doc +
// **教室スナップショット(gzip 解凍)** の読み取りなので、無制限だと漏洩QR 1 枚で読み取り・CPU を増幅できる。
// ★インスタンス単位なので厳密な上限ではない(maxInstances と合わせた歯止め)。厳密にするなら Firestore
//   カウンタが必要で、GET ごとに書き込みが増える(コストの割に得が小さい)。
// ───────────────────────────────────────────────────────────────────────────

/** 1 トークンが 1 窓(10 分)のあいだに GET できる回数。家族が何度も開き直しても届かない値にする。 */
export const PARENT_PORTAL_GET_THROTTLE_LIMIT = 60
export const PARENT_PORTAL_GET_THROTTLE_WINDOW_MS = 10 * 60 * 1000
/** 保持するトークン数の上限(メモリ保護)。超えたら古い窓から捨てる。 */
export const PARENT_PORTAL_GET_THROTTLE_MAX_KEYS = 5000

export type ParentPortalGetThrottleBucket = { windowStartedAtMs: number; hits: number }

/** 窓が切れていれば作り直し、1 回分を数える。allowed=false なら 429 相当。 */
export function decideParentPortalGetThrottle(
  bucket: ParentPortalGetThrottleBucket | undefined,
  nowMs: number,
): { allowed: boolean; bucket: ParentPortalGetThrottleBucket } {
  if (!bucket || nowMs - bucket.windowStartedAtMs >= PARENT_PORTAL_GET_THROTTLE_WINDOW_MS) {
    return { allowed: true, bucket: { windowStartedAtMs: nowMs, hits: 1 } }
  }
  const hits = bucket.hits + 1
  return { allowed: hits <= PARENT_PORTAL_GET_THROTTLE_LIMIT, bucket: { windowStartedAtMs: bucket.windowStartedAtMs, hits } }
}

/** 古い窓のキーを捨てる(上限超過時のみ呼ぶ)。純関数にせず Map を直接触るのは呼び出し側の都合。 */
export function pruneParentPortalGetThrottleKeys(
  buckets: Map<string, ParentPortalGetThrottleBucket>,
  nowMs: number,
  maxKeys: number = PARENT_PORTAL_GET_THROTTLE_MAX_KEYS,
): void {
  if (buckets.size <= maxKeys) return
  for (const [key, bucket] of buckets) {
    if (nowMs - bucket.windowStartedAtMs >= PARENT_PORTAL_GET_THROTTLE_WINDOW_MS) buckets.delete(key)
  }
  // それでも多い場合は挿入順(古い方)から落とす。
  while (buckets.size > maxKeys) {
    const oldest = buckets.keys().next()
    if (oldest.done) break
    buckets.delete(oldest.value)
  }
}

// ───────────────────────────────────────────────────────────────────────────
// 連絡文書(§E-1)。classroomSnapshots/{classroomId}/parentMessages/{messageId}
// ───────────────────────────────────────────────────────────────────────────

export type ParentMessageDoc = {
  workspaceKey: string
  /** ★トークン doc の値(リクエスト body は信用しない。§E-1) */
  classroomId: string
  studentId: string
  /** 保存時点の表示名(後で改名されても当時の宛名が分かる) */
  studentName: string
  body: string
  senderName: string
  createdAt: string
  /** null = 室長未確認。markParentMessagesNotified がサーバー時刻で埋める(§E-2) */
  notifiedAt: string | null
  containsUrl: boolean
  /** ログ・調査用の先頭 6 文字。全文は持たない(§G-1) */
  tokenPrefix: string
}

export function buildParentMessageDoc(params: {
  workspaceKey: string
  classroomId: string
  studentId: string
  studentName: string
  body: string
  senderName: string
  containsUrl: boolean
  createdAt: string
  token: string
}): ParentMessageDoc {
  return {
    workspaceKey: params.workspaceKey,
    classroomId: params.classroomId,
    studentId: params.studentId,
    studentName: params.studentName,
    body: params.body,
    senderName: params.senderName,
    createdAt: params.createdAt,
    notifiedAt: null,
    containsUrl: params.containsUrl,
    tokenPrefix: toParentPortalTokenPrefix(params.token),
  }
}

/** 時系列に並ぶ文書 ID(developerReport と同じ作法): ISO の `:` `.` を `-` に置換 + 乱数サフィックス。 */
export function buildParentMessageId(createdAtIso: string, randomSuffix: string): string {
  return `${createdAtIso.replace(/[:.]/g, '-')}-${randomSuffix}`
}

// ───────────────────────────────────────────────────────────────────────────
// 生徒の同定と在籍(§F)。スナップショットの students から id 一致の行を取り出す。
// ───────────────────────────────────────────────────────────────────────────

export type ParentPortalStudentLike = {
  id: string
  name: string
  displayName: string
  entryDate?: unknown
  withdrawDate?: unknown
  birthDate?: unknown
}

/** `payload.students` から `id === studentId` の行を返す(無ければ null)。名前一致では拾わない(同名別人の混同防止)。 */
export function findParentPortalStudent(payload: unknown, studentId: string): ParentPortalStudentLike | null {
  if (!payload || typeof payload !== 'object') return null
  const students = (payload as { students?: unknown }).students
  if (!Array.isArray(students)) return null
  for (const candidate of students) {
    if (!candidate || typeof candidate !== 'object' || Array.isArray(candidate)) continue
    const row = candidate as Record<string, unknown>
    if (row.id !== studentId) continue
    return {
      id: studentId,
      name: typeof row.name === 'string' ? row.name : '',
      displayName: typeof row.displayName === 'string' ? row.displayName : '',
      entryDate: row.entryDate,
      withdrawDate: row.withdrawDate,
      birthDate: row.birthDate,
    }
  }
  return null
}

/** 表示名(displayName。無ければ name。§C)。 */
export function resolveParentPortalStudentName(student: { name: string; displayName: string }): string {
  const displayName = student.displayName.trim()
  return displayName || student.name.trim()
}

// ───────────────────────────────────────────────────────────────────────────
// HTTP ハンドラ(§G-2 の検証順を GET/POST で共有)
// ───────────────────────────────────────────────────────────────────────────

export const PARENT_PORTAL_ERROR_INVALID_TOKEN = 'リンクの形式が正しくありません。'
/** 410。失効・退塾・卒業・生徒不在の理由を出し分けない(§F)。 */
export const PARENT_PORTAL_ERROR_GONE = 'このリンクは現在ご利用いただけません。教室へお問い合わせください。'
/** 403。機能フラグ OFF(§H)。トークンは失効させない(P-11)。 */
export const PARENT_PORTAL_ERROR_DISABLED = '現在ご利用いただけません。'
export const PARENT_PORTAL_ERROR_METHOD_NOT_ALLOWED = '許可されていないメソッドです。'
export const PARENT_PORTAL_ERROR_INTERNAL = 'サーバーでエラーが発生しました。時間をおいて再度お試しください。'
/** 429(GET のスロットル)。連絡の上限(PARENT_MESSAGE_RATE_LIMIT_ERROR)とは別の文言。 */
export const PARENT_PORTAL_ERROR_TOO_MANY_REQUESTS = 'アクセスが集中しています。少し待ってから開き直してください。'

export type ParentPortalRange = { from: string; to: string }
export type ParentPortalResolvedRange = ParentPortalRange & { bounds: { minFrom: string; maxTo: string } }

export type ParentPortalDeps = {
  /** `studentPortalTokens/{token}`。無ければ null。 */
  loadToken: (token: string) => Promise<StudentPortalTokenDoc | null>
  /** `workspaces/{ws}/classrooms/{classroomId}`。無ければ null。 */
  loadClassroom: (workspaceKey: string, classroomId: string) => Promise<{ name: string } | null>
  /** `workspaces/{ws}/classroomSnapshots/{classroomId}` を readStoredSnapshotPayload で展開したもの。無ければ null。 */
  loadSnapshot: (workspaceKey: string, classroomId: string) => Promise<{ payload: unknown; savedAt: string | null } | null>
  /** generated/parentSchedule の buildParentScheduleView。生徒が無ければ null。 */
  buildScheduleView: (payload: unknown, studentId: string, range: ParentPortalRange) => { studentName: string; days: unknown[]; hasLectureLessons?: boolean } | null
  /** generated/parentSchedule の resolveParentScheduleRange。 */
  resolveRange: (input: { from?: unknown; to?: unknown }, todayKey: string) => ParentPortalResolvedRange
  /** generated/parentSchedule の isParentStudentActiveOnDate(盤面・日程表と同じ isActiveOnDate。§F)。 */
  isStudentActive: (student: { entryDate?: unknown; withdrawDate?: unknown; birthDate?: unknown }, dateKey: string) => boolean
  /** 機能フラグ(§H)。index.ts が projectId を補う。教室は (workspaceKey, id) の組で判定する。 */
  isEnabled: (identity: { workspaceKey: string; id: string }) => boolean
  /** JST の今日 `YYYY-MM-DD`。 */
  todayJst: () => string
  nowIso: () => string
  /**
   * 回数制限の枠を 1 つ消費する。トランザクションで「読む → 判定 → 許可のときだけ加算」を行い、
   * 拒否のときは**何も書かない**(resolveParentMessageRateLimitOutcome)。
   */
  consumeMessageQuota: (params: { workspaceKey: string; classroomId: string } & ParentMessageRateLimitKeys) => Promise<{ allowed: boolean; error?: string }>
  /** parentMessages へ追加する。 */
  saveMessage: (params: { workspaceKey: string; classroomId: string; doc: ParentMessageDoc }) => Promise<unknown>
}

export type ParentPortalHandlerResult = { status: number; body: unknown }

type ParentPortalVerifiedContext = {
  token: string
  tokenDoc: StudentPortalTokenDoc
  classroomName: string
  snapshot: { payload: unknown; savedAt: string | null }
  student: ParentPortalStudentLike
  today: string
}

/**
 * GET/POST 共通の検証(§G-2・順序を変えない。1 つ落ちたら以降を実行しない):
 *  (1) トークン文字列の形 → 400
 *  (2) `studentPortalTokens/{token}` が無い／失効済み → 410
 *  (3) 教室 doc の実在を確かめ(無ければ 410)、機能フラグを (workspaceKey, 教室ID) で評価 → OFF なら 403
 *      ※教室名は表示用に読むだけで、機能フラグの判定には使わない(2026-09-16・登録台帳へ一本化)
 *  (4) スナップショットを読み、生徒が実在し当日(JST)在籍 → でなければ 410
 * ★(1)(2)(3) で落ちた場合はスナップショットを読まない(K-4「読んでから弾く実装にしない」)。
 */
async function verifyParentPortalRequest(token: string, deps: ParentPortalDeps): Promise<{ ok: true; context: ParentPortalVerifiedContext } | { ok: false; result: ParentPortalHandlerResult }> {
  if (!isValidParentPortalToken(token)) {
    return { ok: false, result: { status: 400, body: { error: PARENT_PORTAL_ERROR_INVALID_TOKEN } } }
  }

  const tokenDoc = await deps.loadToken(token)
  if (!isStudentPortalTokenActive(tokenDoc)) {
    return { ok: false, result: { status: 410, body: { error: PARENT_PORTAL_ERROR_GONE } } }
  }

  // ★教室はトークン doc の値が権威(リクエストのパラメータで教室を切り替えられない)。
  const classroom = await deps.loadClassroom(tokenDoc.workspaceKey, tokenDoc.classroomId)
  if (!classroom) {
    return { ok: false, result: { status: 410, body: { error: PARENT_PORTAL_ERROR_GONE } } }
  }
  if (!deps.isEnabled({ workspaceKey: tokenDoc.workspaceKey, id: tokenDoc.classroomId })) {
    return { ok: false, result: { status: 403, body: { error: PARENT_PORTAL_ERROR_DISABLED } } }
  }

  const snapshot = await deps.loadSnapshot(tokenDoc.workspaceKey, tokenDoc.classroomId)
  if (!snapshot) {
    return { ok: false, result: { status: 410, body: { error: PARENT_PORTAL_ERROR_GONE } } }
  }
  const student = findParentPortalStudent(snapshot.payload, tokenDoc.studentId)
  if (!student) {
    return { ok: false, result: { status: 410, body: { error: PARENT_PORTAL_ERROR_GONE } } }
  }
  const today = deps.todayJst()
  if (!deps.isStudentActive(student, today)) {
    return { ok: false, result: { status: 410, body: { error: PARENT_PORTAL_ERROR_GONE } } }
  }

  return { ok: true, context: { token, tokenDoc, classroomName: classroom.name, snapshot, student, today } }
}

/** GET `/api/parent/{token}?from&to` → 200 ParentPortalScheduleResponse(k_contract §1)。 */
export async function handleParentPortalGet(
  req: { token: string; from?: unknown; to?: unknown },
  deps: ParentPortalDeps,
): Promise<ParentPortalHandlerResult> {
  const verified = await verifyParentPortalRequest(req.token, deps)
  if (!verified.ok) return verified.result
  const { tokenDoc, classroomName, snapshot, student, today } = verified.context

  const range = deps.resolveRange({ from: req.from, to: req.to }, today)
  const view = deps.buildScheduleView(snapshot.payload, tokenDoc.studentId, { from: range.from, to: range.to })
  if (!view) {
    return { status: 410, body: { error: PARENT_PORTAL_ERROR_GONE } }
  }

  // ★応答に studentId / classroomId / トークン / 講師名 / 机 / 他生徒 / 在庫数を含めない(§C)。
  return {
    status: 200,
    body: {
      studentName: view.studentName || resolveParentPortalStudentName(student),
      classroomName,
      snapshotSavedAt: snapshot.savedAt,
      today,
      range: { from: range.from, to: range.to },
      bounds: { minFrom: range.bounds.minFrom, maxTo: range.bounds.maxTo },
      days: view.days,
      // 講習だけの月の注記用(講習コマの中身は出さない)。
      hasLectureLessons: view.hasLectureLessons === true,
    },
  }
}

/** POST `/api/parent/{token}` body `{ body, senderName? }` → 200 `{ ok: true, createdAt }`。 */
export async function handleParentPortalPost(
  req: { token: string; rawBody: unknown },
  deps: ParentPortalDeps,
): Promise<ParentPortalHandlerResult> {
  const verified = await verifyParentPortalRequest(req.token, deps)
  if (!verified.ok) return verified.result
  const { token, tokenDoc, student } = verified.context

  // 本文の検証(400)は回数制限(429)より先。壊れた入力で枠を消費させない。
  const input = normalizeParentMessageInput(req.rawBody)
  if (!input.ok) {
    return { status: 400, body: { error: input.error } }
  }

  const nowIso = deps.nowIso()
  const keys = buildParentMessageRateLimitKeys(token, nowIso)
  const quota = await deps.consumeMessageQuota({ workspaceKey: tokenDoc.workspaceKey, classroomId: tokenDoc.classroomId, ...keys })
  if (!quota.allowed) {
    return { status: 429, body: { error: quota.error ?? PARENT_MESSAGE_RATE_LIMIT_ERROR } }
  }

  // studentName は保存時点の表示名(スナップショットから)。classroomId / studentId はトークン doc 由来。
  const doc = buildParentMessageDoc({
    workspaceKey: tokenDoc.workspaceKey,
    classroomId: tokenDoc.classroomId,
    studentId: tokenDoc.studentId,
    studentName: resolveParentPortalStudentName(student),
    body: input.body,
    senderName: input.senderName,
    containsUrl: input.containsUrl,
    createdAt: nowIso,
    token,
  })
  await deps.saveMessage({ workspaceKey: tokenDoc.workspaceKey, classroomId: tokenDoc.classroomId, doc })

  return { status: 200, body: { ok: true, createdAt: nowIso } }
}

// ───────────────────────────────────────────────────────────────────────────
// callable の入力正規化(issue / revoke / markNotified)。例外は index.ts が HttpsError に変換する。
// ───────────────────────────────────────────────────────────────────────────

type NormalizeResult<T> = { ok: true; value: T } | { ok: false; reason: string }

function readRequiredString(data: Record<string, unknown>, key: string): string {
  return typeof data[key] === 'string' ? String(data[key]).trim() : ''
}

function readRequestObject(raw: unknown): Record<string, unknown> | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  return raw as Record<string, unknown>
}

export type IssueStudentPortalTokenRequest = {
  workspaceKey: string
  classroomId: string
  studentId: string
  reissue: boolean
}

export function normalizeIssueRequest(raw: unknown): NormalizeResult<IssueStudentPortalTokenRequest> {
  const data = readRequestObject(raw)
  if (!data) return { ok: false, reason: 'request.data の形式が不正です。' }
  const workspaceKey = readRequiredString(data, 'workspaceKey')
  const classroomId = readRequiredString(data, 'classroomId')
  const studentId = readRequiredString(data, 'studentId')
  if (!workspaceKey) return { ok: false, reason: 'workspaceKey は文字列で指定してください。' }
  if (!classroomId) return { ok: false, reason: 'classroomId は文字列で指定してください。' }
  if (!studentId) return { ok: false, reason: 'studentId は文字列で指定してください。' }
  return { ok: true, value: { workspaceKey, classroomId, studentId, reissue: data.reissue === true } }
}

export type RevokeStudentPortalTokenRequest = {
  workspaceKey: string
  classroomId: string
  studentId: string
  reason: 'manual' | 'studentDeleted'
}

export function normalizeRevokeRequest(raw: unknown): NormalizeResult<RevokeStudentPortalTokenRequest> {
  const data = readRequestObject(raw)
  if (!data) return { ok: false, reason: 'request.data の形式が不正です。' }
  const workspaceKey = readRequiredString(data, 'workspaceKey')
  const classroomId = readRequiredString(data, 'classroomId')
  const studentId = readRequiredString(data, 'studentId')
  if (!workspaceKey) return { ok: false, reason: 'workspaceKey は文字列で指定してください。' }
  if (!classroomId) return { ok: false, reason: 'classroomId は文字列で指定してください。' }
  if (!studentId) return { ok: false, reason: 'studentId は文字列で指定してください。' }
  const reason = data.reason
  if (reason !== 'manual' && reason !== 'studentDeleted') {
    return { ok: false, reason: 'reason は manual または studentDeleted を指定してください。' }
  }
  return { ok: true, value: { workspaceKey, classroomId, studentId, reason } }
}

/** 1 回の既読化で受け付ける ID の上限。モーダルの「確認」1 回ぶん(未読が 50 件を超える運用は想定しない)。 */
export const PARENT_MESSAGE_MARK_NOTIFIED_MAX_IDS = 50
/** 文書 ID の形(buildParentMessageId の出力 = ISO 由来の英数字と `-`)。パス区切りや空白を弾く。 */
export const PARENT_MESSAGE_ID_PATTERN = /^[A-Za-z0-9_-]{1,128}$/

export type MarkParentMessagesNotifiedRequest = {
  workspaceKey: string
  classroomId: string
  messageIds: string[]
}

export function normalizeMarkNotifiedRequest(raw: unknown): NormalizeResult<MarkParentMessagesNotifiedRequest> {
  const data = readRequestObject(raw)
  if (!data) return { ok: false, reason: 'request.data の形式が不正です。' }
  const workspaceKey = readRequiredString(data, 'workspaceKey')
  const classroomId = readRequiredString(data, 'classroomId')
  if (!workspaceKey) return { ok: false, reason: 'workspaceKey は文字列で指定してください。' }
  if (!classroomId) return { ok: false, reason: 'classroomId は文字列で指定してください。' }
  if (!Array.isArray(data.messageIds)) return { ok: false, reason: 'messageIds は配列で指定してください。' }
  const messageIds: string[] = []
  for (const candidate of data.messageIds) {
    if (typeof candidate !== 'string' || !PARENT_MESSAGE_ID_PATTERN.test(candidate)) {
      return { ok: false, reason: 'messageIds に不正な ID が含まれています。' }
    }
    if (!messageIds.includes(candidate)) messageIds.push(candidate)
  }
  if (messageIds.length === 0) return { ok: false, reason: 'messageIds が空です。' }
  if (messageIds.length > PARENT_MESSAGE_MARK_NOTIFIED_MAX_IDS) {
    return { ok: false, reason: `messageIds は ${PARENT_MESSAGE_MARK_NOTIFIED_MAX_IDS} 件以内で指定してください。` }
  }
  return { ok: true, value: { workspaceKey, classroomId, messageIds } }
}

/** 既読化の対象: 実在し、まだ notifiedAt が null の文書だけ(既読は上書きしない = 最初に確認した時刻を保つ)。 */
export function selectParentMessageIdsToMarkNotified(docs: ReadonlyArray<{ id: string; exists: boolean; notifiedAt: unknown }>): string[] {
  return docs.filter((doc) => doc.exists && (doc.notifiedAt === null || typeof doc.notifiedAt === 'undefined')).map((doc) => doc.id)
}

// ───────────────────────────────────────────────────────────────────────────
// 発行・失効の決定(§B-2)。Firestore への書き込み内容をデータとして返し、index.ts がトランザクションで適用する。
// ───────────────────────────────────────────────────────────────────────────

export type StudentPortalTokenWrite =
  | { op: 'revokeToken'; token: string; revokedAt: string; revokedReason: StudentPortalTokenRevokedReason }
  | { op: 'createToken'; token: string; doc: StudentPortalTokenDoc }
  | { op: 'setOwner'; ownerId: string; doc: StudentPortalOwnerDoc }
  | { op: 'deleteOwner'; ownerId: string }

export type IssueDecision = {
  token: string
  /** 旧トークンを失効させて新規発行したか(有効な旧トークンが無ければ false = 初回発行)。 */
  reissued: boolean
  writes: StudentPortalTokenWrite[]
}

/**
 * 発行(getOrIssue・冪等):
 *  - 有効トークンがあり reissue でない → そのトークンを返す(書き込み無し)。
 *  - 有効トークンがあり reissue → 旧を `revokedReason='reissue'` で失効させ、新規発行(有効は常に 1 本)。
 *  - 有効トークンが無い(未発行／索引はあるが失効済み) → 新規発行。
 * `existingToken` は `existingOwner.token` の doc(索引が指す先)。索引が壊れていても新規発行で自己修復する。
 */
export function resolveIssueDecision(params: {
  existingOwner: StudentPortalOwnerDoc | null
  existingToken: StudentPortalTokenDoc | null
  reissue: boolean
  nowIso: string
  newToken: string
  issuer: { workspaceKey: string; classroomId: string; studentId: string; createdByUid: string }
}): IssueDecision {
  const { existingOwner, existingToken, reissue, nowIso, newToken, issuer } = params
  const hasActiveToken = Boolean(existingOwner?.token) && isStudentPortalTokenActive(existingToken)
    && existingToken.classroomId === issuer.classroomId && existingToken.studentId === issuer.studentId

  if (hasActiveToken && !reissue) {
    return { token: existingOwner!.token, reissued: false, writes: [] }
  }

  const writes: StudentPortalTokenWrite[] = []
  if (hasActiveToken) {
    writes.push({ op: 'revokeToken', token: existingOwner!.token, revokedAt: nowIso, revokedReason: 'reissue' })
  }
  writes.push({
    op: 'createToken',
    token: newToken,
    doc: {
      workspaceKey: issuer.workspaceKey,
      classroomId: issuer.classroomId,
      studentId: issuer.studentId,
      createdAt: nowIso,
      createdByUid: issuer.createdByUid,
      revokedAt: null,
    },
  })
  writes.push({
    op: 'setOwner',
    ownerId: buildStudentPortalOwnerId(issuer.classroomId, issuer.studentId),
    doc: {
      workspaceKey: issuer.workspaceKey,
      classroomId: issuer.classroomId,
      studentId: issuer.studentId,
      token: newToken,
      updatedAt: nowIso,
    },
  })
  return { token: newToken, reissued: hasActiveToken, writes }
}

export type RevokeDecision = {
  revoked: boolean
  writes: StudentPortalTokenWrite[]
}

/**
 * 失効(不可逆): 索引が指す有効トークンを `revokedReason=reason` で失効させ、索引を消す。
 * 有効トークンが無ければ何もしない(revoked: false)。失効済みの古い索引だけが残っていれば索引だけ消す。
 */
export function resolveRevokeDecision(params: {
  existingOwner: StudentPortalOwnerDoc | null
  existingToken: StudentPortalTokenDoc | null
  reason: 'manual' | 'studentDeleted'
  nowIso: string
  classroomId: string
  studentId: string
}): RevokeDecision {
  const { existingOwner, existingToken, reason, nowIso, classroomId, studentId } = params
  const ownerId = buildStudentPortalOwnerId(classroomId, studentId)
  if (!existingOwner?.token) {
    return { revoked: false, writes: [] }
  }
  const writes: StudentPortalTokenWrite[] = []
  const revoked = isStudentPortalTokenActive(existingToken)
    && existingToken.classroomId === classroomId && existingToken.studentId === studentId
  if (revoked) {
    writes.push({ op: 'revokeToken', token: existingOwner.token, revokedAt: nowIso, revokedReason: reason })
  }
  writes.push({ op: 'deleteOwner', ownerId })
  return { revoked, writes }
}

export function readStudentPortalOwnerDoc(raw: unknown): StudentPortalOwnerDoc | null {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return null
  const data = raw as Record<string, unknown>
  const token = typeof data.token === 'string' ? data.token : ''
  if (!token) return null
  return {
    workspaceKey: typeof data.workspaceKey === 'string' ? data.workspaceKey : '',
    classroomId: typeof data.classroomId === 'string' ? data.classroomId : '',
    studentId: typeof data.studentId === 'string' ? data.studentId : '',
    token,
    updatedAt: typeof data.updatedAt === 'string' ? data.updatedAt : '',
  }
}
