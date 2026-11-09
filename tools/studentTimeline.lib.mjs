// 生徒ごとの経緯ツール(tools/student-timeline.mjs)の純関数。ネットワークにもファイルにも触らない。
//
// ★何をするか(2026-11-09・オーナー確定)
//   室長の曖昧な連絡(「未消化が多分消えてる」「組んだ通りになってない」)に 1 週間以上遡って答えるため、
//   1 人の生徒について 4 つの記録を時刻順に 1 本へ並べる。
//     - 生徒授業台帳(lessonLedgerDays)… 日ごとの未消化・実績。前の台帳の日から変わった日を「変化日」とする。
//     - 操作ログ(operationEvents)     … 在庫が減る・記録が消える操作(誰がいつ)。
//     - 操作痕跡(operationTraces)     … 保存に同梱された盤面の確定の要約(「名前#ID」を含む)。
//     - 保存ごとの版(classroom-save-history)… 変化日の最初と最後の版とその直前の版だけを比べた、その生徒の机の変化。
//
// ★名前は既定で ID に置き換える(公開リポジトリ・本番データ保護ルール)。痕跡の要約には他の生徒の名前も入るので、
//   名簿の全員(生徒・講師)を置き換え、名簿に無い「名前#ID」も #ID の前を伏せる。名前を出すのは showNames のときだけ。
// ★黙って空にしない: 版の無い日は「この日の保存の版は無い」、取れなかった元は「取得できず: 理由」と 1 行出す。

const JST_OFFSET_MS = 9 * 60 * 60 * 1000
const MS_PER_DAY = 24 * 60 * 60 * 1000

export const SOURCE_LABELS = { ledger: '台帳', event: '操作ログ', trace: '痕跡', version: '版' }

/** 記録がある最初の日(2026-11-09 に本番で確かめた値)。これより前を頼まれたら「記録が無い」と出すため。 */
export const SOURCE_EARLIEST_DATE = { ledger: '2026-09-04', event: '2026-09-04', trace: '2026-10-22' }
/** 保存ごとの版の保持日数(functions/src/index.ts CLASSROOM_SAVE_HISTORY_RETENTION_DAYS と同じ)。 */
export const SAVE_HISTORY_RETENTION_DAYS = 90

/** 1 つの変化の中で並べるコマ(トークン)の上限。 */
const TOKEN_LIST_LIMIT = 6

export const EVENT_KIND_LABELS = {
  'makeup-stock-delete': '未消化振替の削除',
  'lecture-stock-delete': '未消化講習の削除',
  'lesson-delete': 'コマの削除',
  'lesson-store': '未消化へ戻す',
  'status-mark': '出欠を付けた',
  'status-clear': '出欠を外した',
  'clear-day-students': 'その日の生徒を全部削除',
  'whole-day-transfer': '丸ごと振替',
  'holiday-toggle': '休日の設定/解除',
  'record-displaced': '移動で別の記録を上書き',
  'auto-teacher-reconcile': '自動: 講師の自己修復',
  'auto-teacher-assign': '自動: 講師の登録/解除',
  'auto-student-unassign': '自動: 生徒の登録解除で講習コマを除去',
}

/** 生徒を名指ししない「日付全体」の操作。その生徒の授業がある日のものだけ残す。 */
const DATE_WIDE_EVENT_KINDS = new Set(['holiday-toggle', 'whole-day-transfer', 'clear-day-students'])
const DATE_DETAIL_KEYS = ['dateKey', 'sourceDateKey', 'targetDateKey']
const NAME_DETAIL_KEYS = ['studentName', 'displacedStudentName', 'teacherName']

// ---------------------------------------------------------------------------
// 日付
// ---------------------------------------------------------------------------

/** ISO 時刻の JST の日付(YYYY-MM-DD)。読めなければ空文字。 */
export function toJstDateKey(iso) {
  const ms = Date.parse(String(iso ?? ''))
  if (!Number.isFinite(ms)) return ''
  return new Date(ms + JST_OFFSET_MS).toISOString().slice(0, 10)
}

/** YYYY-MM-DD に日数を足す(暦の上で)。 */
export function addDays(dateKey, days) {
  const ms = Date.parse(`${dateKey}T00:00:00.000Z`)
  return new Date(ms + days * MS_PER_DAY).toISOString().slice(0, 10)
}

/** JST の日の始まり(00:00 JST)の ISO(UTC・toISOString の形。保存側の recordedAt と文字列で比べられる)。 */
export function jstDayStartIso(dateKey) {
  return new Date(Date.parse(`${dateKey}T00:00:00.000Z`) - JST_OFFSET_MS).toISOString()
}

/** JST の今日。 */
export function jstToday(now = Date.now()) {
  return new Date(now + JST_OFFSET_MS).toISOString().slice(0, 10)
}

/** ISO 時刻を「MM-DD HH:mm」(JST)にする。読めなければそのまま。 */
export function formatJstShort(iso) {
  const ms = Date.parse(String(iso ?? ''))
  if (!Number.isFinite(ms)) return String(iso ?? '')
  const jst = new Date(ms + JST_OFFSET_MS).toISOString()
  return `${jst.slice(5, 10)} ${jst.slice(11, 16)}`
}

// ---------------------------------------------------------------------------
// 名前の置き換え
// ---------------------------------------------------------------------------

function escapeRegExp(text) {
  return String(text).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

const ID_CHARS = 'A-Za-z0-9_-'

/** 文に「#ID」(後ろに ID の文字が続かない)が含まれるか。s001 で s0011 を拾わない。 */
export function containsStudentRef(text, studentId) {
  if (!studentId) return false
  return new RegExp(`#${escapeRegExp(studentId)}(?![${ID_CHARS}])`).test(String(text ?? ''))
}

function nameVariants(name) {
  const trimmed = String(name ?? '').trim()
  if (!trimmed) return []
  return [...new Set([trimmed, trimmed.replace(/\s+/g, ''), trimmed.replace(/\s+/g, ' '), trimmed.replace(/\s+/g, '　')])]
}

// 「名前#ID」の名前側に来ない文字(区切り)。
const NAME_STOP_CHARS = '\\s#()（）\\[\\]［］{}<>/:：、。,，・「」『』|+→←=＝'
// 名前の前後に来たら「名前の一部」とみなす文字(日本語の文字・英数字)。部分一致を当てないための境目。
const WORD_BEFORE = '(?<![\\p{L}\\p{N}])'
const WORD_AFTER = '(?![\\p{L}\\p{N}])'
// 「姓 名#ID」の姓の側に来うる語(日本語の文字だけ)。
const JAPANESE_WORD = '[\\p{sc=Han}\\p{sc=Hiragana}\\p{sc=Katakana}ー々]+'
// 「語 名前#ID」の語が名前ではなく見出し(出欠・種別・操作)のときは残す。
const KEEP_LEADING_WORDS = new Set(['出席', '休み', '振無休', '移動', '休日', '記録', '通常', '振替', '講習', '増コマ', '体験', '退塾', '退塾取消', '削除', '追加', 'メモ', '元に戻す', 'やり直し', '講師なし', '空'])
// 名前が入る操作ログの項目(痕跡の operation-event の要約は「key=値」を空白でつないだ形)。
const NAME_KEY_PATTERN = /\b(studentName|displacedStudentName|teacherName)=(.*?)(?=\s+[A-Za-z][A-Za-z0-9_]*=|$)/g
const PERSON_ID_PATTERN = /^[st]\d+$/

/**
 * 文の中の名前を伏せる(生徒も講師も)。順番に意味がある(2026-11-09 修正ラウンド 1・本番予行で体験生の名前が残り、
 * 別人の名前の部分一致で取り違えた ID まで付いた漏れの再発防止)。
 *   1. 「名前#ID」の形を先に処理する。# の後ろが生徒/講師の ID(名簿の ID か sNNN/tNNN)なら「名前#」ごと ID にする。
 *      そうでない(体験生の盤面エントリ ID など)なら名前を「体験生」(直後が「(trial」「(体験」)か「名簿外」に置き換え、
 *      エントリ ID は残す。台帳のコマ「2026-11-02#3」は名前ではないので崩さない。「姓 名#ID」の姓も伏せる。
 *   2. 名簿の名前・表示名を ID に置き換える。前後が日本語の文字・英数字なら置き換えない(別人の名前の一部に当てない)。
 *      長い名前から順に。空白の有無・全角/半角の空白の違いも置き換える。
 *   3. 操作ログの「studentName=名前」など名前の項目は、ID にならなかった値を「(名簿外)」にする。
 * - options.except に渡した ID の人だけは名前を残す。
 * - 自由記述(メモなど)の中の名簿に無い名前は伏せられない(出力はスクラッチ領域にだけ置く・手順書)。
 * @param {string} text
 * @param {Array<{ id: string, name?: string, displayName?: string }>} roster
 * @param {{ except?: string }} [options]
 */
export function maskNames(text, roster, options = {}) {
  const except = options.except ?? ''
  let result = String(text ?? '')
  const rosterIds = new Set((roster ?? []).map((person) => String(person?.id ?? '').trim()).filter(Boolean))
  const isPersonId = (id) => rosterIds.has(id) || PERSON_ID_PATTERN.test(id)
  const exceptNames = new Set((roster ?? []).filter((person) => except && person?.id === except).flatMap((person) => [...nameVariants(person.name), ...nameVariants(person.displayName)]))
  const replacements = []
  for (const person of roster ?? []) {
    const id = String(person?.id ?? '').trim()
    if (!id || id === except) continue
    for (const variant of [...nameVariants(person.name), ...nameVariants(person.displayName)]) replacements.push({ variant, id })
  }
  replacements.sort((left, right) => right.variant.length - left.variant.length)
  const variants = [...new Map(replacements.map((entry) => [entry.variant, entry])).values()]

  // 1a. 名簿の名前(空白入りも)の「名前#生徒ID」→ 生徒ID。
  for (const { variant } of variants) {
    result = result.replace(new RegExp(`${WORD_BEFORE}${escapeRegExp(variant)}#([${ID_CHARS}]+)`, 'gu'), (match, id) => (isPersonId(id) && id !== except ? id : match))
  }
  // 1b. 残りの「名前#ID」(名簿に無い名前・体験生・削除済みの生徒など)。
  result = result.replace(new RegExp(`(?:(${JAPANESE_WORD})([ 　]))?([^${NAME_STOP_CHARS}]+)#([${ID_CHARS}]+)`, 'gu'), (match, word, space, prefix, id, offset, whole) => {
    if (/^[\d./-]+$/.test(prefix)) return match
    if (except && id === except) return match
    if (PERSON_ID_PATTERN.test(prefix) || rosterIds.has(prefix)) return match
    const lead = word && KEEP_LEADING_WORDS.has(word) ? `${word}${space}` : ''
    if (isPersonId(id)) return `${lead}${id}`
    const after = whole.slice(offset + match.length)
    const label = /^[(（](trial|体験)/.test(after) ? '体験生' : '名簿外'
    return `${lead}${label}#${id}`
  })
  // 2. 名簿の名前(境目を確かめる)。
  for (const { variant, id } of variants) {
    result = result.replace(new RegExp(`${WORD_BEFORE}${escapeRegExp(variant)}${WORD_AFTER}`, 'gu'), id)
  }
  // 3. 名前の項目の値で ID にならなかったもの。
  result = result.replace(NAME_KEY_PATTERN, (match, key, value) => {
    const trimmed = value.trim()
    if (!trimmed || isPersonId(trimmed) || trimmed.startsWith('(')) return match
    if (exceptNames.has(trimmed)) return match
    return `${key}=(名簿外)`
  })
  return result
}

// ---------------------------------------------------------------------------
// 生徒授業台帳
// ---------------------------------------------------------------------------

function asArray(value) {
  return Array.isArray(value) ? value : []
}

function shortToken(token) {
  const [where, lessonType] = String(token ?? '').split('|')
  return lessonType ? `${where}(${lessonType})` : where
}

function listTokens(tokens) {
  const shown = tokens.slice(0, TOKEN_LIST_LIMIT).map(shortToken)
  return `${shown.join(' ')}${tokens.length > shown.length ? ` 他${tokens.length - shown.length}` : ''}`
}

function rowBelongsTo(row, studentId) {
  return row && (row.studentId === studentId || (!row.studentId && row.studentKey === studentId))
}

/** その生徒の 1 日分の台帳を「科目(講習)ごとの状態」にする。 */
function studentLedgerState(day, studentId) {
  const state = new Map()
  for (const row of asArray(day?.rows)) {
    if (!rowBelongsTo(row, studentId)) continue
    state.set(`通常/振替 ${row.subject ?? ''}`, {
      kind: 'regular',
      makeupBalance: Number(row.makeupBalance) || 0,
      makeupRemaining: asArray(row.makeupRemaining).map(String),
      attended: asArray(row.attended).map(String),
      absent: asArray(row.absent).map(String),
      absentNoMakeup: asArray(row.absentNoMakeup).map(String),
      placed: asArray(row.placed).map(String),
    })
  }
  for (const row of asArray(day?.lectureRows)) {
    if (!rowBelongsTo(row, studentId)) continue
    state.set(`講習 ${row.sessionLabel || row.sessionId || ''} ${row.subject ?? ''}`, {
      kind: 'lecture',
      pending: Number(row.pending) || 0,
      origins: asArray(row.origins).map(String),
    })
  }
  return state
}

function tokenDiff(label, before, after) {
  const beforeSet = new Set(before)
  const afterSet = new Set(after)
  const added = after.filter((token) => !beforeSet.has(token))
  const removed = before.filter((token) => !afterSet.has(token))
  const parts = []
  if (added.length > 0) parts.push(`${label} +${listTokens(added)}`)
  if (removed.length > 0) parts.push(`${label} -${listTokens(removed)}`)
  return parts
}

const REGULAR_TOKEN_FIELDS = [['attended', '出席'], ['absent', '休み'], ['absentNoMakeup', '振無休'], ['placed', '配置']]

function describeState(key, value) {
  if (value.kind === 'lecture') return `${key}: 未消化講習 ${value.pending}${value.origins.length > 0 ? `(元コマ ${listTokens(value.origins)})` : ''}`
  const counts = REGULAR_TOKEN_FIELDS.map(([field, label]) => `${label} ${value[field].length}`).join('・')
  return `${key}: 未消化振替 ${value.makeupBalance}${value.makeupRemaining.length > 0 ? `(元コマ ${listTokens(value.makeupRemaining)})` : ''}・${counts}`
}

function describeStateChange(key, before, after) {
  if (!before) return [`${key}: 台帳に行が現れた → ${describeState(key, after).slice(key.length + 2)}`]
  if (!after) return [`${key}: 台帳から行が消えた(前は ${describeState(key, before).slice(key.length + 2)})`]
  const parts = []
  if (after.kind === 'lecture') {
    if (before.pending !== after.pending) parts.push(`未消化講習 ${before.pending}→${after.pending}`)
    parts.push(...tokenDiff('元コマ', before.origins, after.origins))
  } else {
    if (before.makeupBalance !== after.makeupBalance) parts.push(`未消化振替 ${before.makeupBalance}→${after.makeupBalance}`)
    parts.push(...tokenDiff('未消化の元コマ', before.makeupRemaining, after.makeupRemaining))
    for (const [field, label] of REGULAR_TOKEN_FIELDS) parts.push(...tokenDiff(label, before[field], after[field]))
  }
  return parts.length > 0 ? [`${key}: ${parts.join(' / ')}`] : []
}

/**
 * 台帳の日ごとに、その生徒の状態と前の台帳の日からの変化を出す(日付の古い順)。
 * - kind 'baseline': 最初の日(比べる相手が無い)。状態をそのまま並べる。
 * - kind 'change'  : 前の日から変わった日(=変化日)。何がいくつからいくつへ・増えた/消えたコマ。
 * - kind 'absent'  : 期間のどの台帳にもこの生徒の行が無い(黙らずに 1 行)。
 * 変わらなかった日は出さない。
 */
export function summarizeLedgerDays(ledgerDays, studentId) {
  const days = [...asArray(ledgerDays)].sort((left, right) => String(left.dateKey).localeCompare(String(right.dateKey)))
  const result = []
  let previous = null
  let everSeen = false
  for (const day of days) {
    const state = studentLedgerState(day, studentId)
    if (state.size > 0) everSeen = true
    if (previous === null) {
      result.push({
        dateKey: day.dateKey,
        savedAt: day.savedAt ?? '',
        kind: 'baseline',
        lines: state.size > 0 ? [...state].map(([key, value]) => describeState(key, value)) : ['この日の台帳にこの生徒の行は無い'],
      })
    } else {
      const keys = [...new Set([...previous.keys(), ...state.keys()])].sort()
      const lines = keys.flatMap((key) => describeStateChange(key, previous.get(key), state.get(key)))
      if (lines.length > 0) result.push({ dateKey: day.dateKey, savedAt: day.savedAt ?? '', kind: 'change', lines })
    }
    previous = state
  }
  if (days.length > 0 && !everSeen) {
    return [{ dateKey: days[0].dateKey, savedAt: days[0].savedAt ?? '', kind: 'absent', lines: [`期間の台帳(${days.length} 日)のどれにもこの生徒の行が無い`] }]
  }
  return result
}

/** 変化日(前の台帳の日からその生徒の状態が変わった日)の一覧。 */
export function findLedgerChangeDays(ledgerDays, studentId) {
  return summarizeLedgerDays(ledgerDays, studentId).filter((day) => day.kind === 'change').map((day) => day.dateKey)
}

/** 台帳に出てくるその生徒のコマの日付(出席・休み・配置・未消化の元コマ)。日付全体の操作を絞るのに使う。 */
export function collectStudentLedgerDates(ledgerDays, studentId) {
  const dates = new Set()
  for (const day of asArray(ledgerDays)) {
    for (const [, value] of studentLedgerState(day, studentId)) {
      const tokens = value.kind === 'lecture' ? value.origins : [...value.makeupRemaining, ...REGULAR_TOKEN_FIELDS.flatMap(([field]) => value[field])]
      for (const token of tokens) {
        const dateKey = String(token).slice(0, 10)
        if (/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) dates.add(dateKey)
      }
    }
  }
  return dates
}

// ---------------------------------------------------------------------------
// 操作ログ・操作痕跡
// ---------------------------------------------------------------------------

/**
 * 操作ログからその生徒の行を残す。
 * - detail.managedStudentId がその生徒 / どれかの値に「#ID」/ ID が無い行は studentName が生徒の名前と一致。
 * - 日付全体の操作(休日・丸ごと振替・その日の全削除)は、その生徒の授業がある日(studentDates)のものだけ。
 */
export function filterStudentEvents(events, studentId, options = {}) {
  const names = new Set((options.studentNames ?? []).flatMap(nameVariants))
  const dates = options.studentDates ?? new Set()
  return asArray(events).filter((event) => {
    const detail = event?.detail && typeof event.detail === 'object' ? event.detail : {}
    if (detail.managedStudentId === studentId) return true
    if (Object.values(detail).some((value) => typeof value === 'string' && containsStudentRef(value, studentId))) return true
    if (!detail.managedStudentId && typeof detail.studentName === 'string' && names.has(detail.studentName.trim())) return true
    // 出欠で上書きされた側の生徒は displacedStudentName にだけ残る(ScheduleBoardScreen の buildStatusMarkDetail・修正ラウンド 2)。
    if (isDisplacedStudentEvent(event, studentId, names)) return true
    if (DATE_WIDE_EVENT_KINDS.has(event.kind)) return DATE_DETAIL_KEYS.some((key) => typeof detail[key] === 'string' && dates.has(detail[key]))
    return false
  })
}

/** その生徒が出欠で上書きされた側(displacedStudentName)として載っている操作ログか。 */
function isDisplacedStudentEvent(event, studentId, names) {
  const detail = event?.detail && typeof event.detail === 'object' ? event.detail : {}
  return detail.managedStudentId !== studentId && typeof detail.displacedStudentName === 'string' && names.has(detail.displacedStudentName.trim())
}

/**
 * 文に生徒の名前の直後に # が来る形(「名前#盤面のエントリID」)があるか。盤面の生徒に managedStudentId が無いと
 * 机と痕跡は「名前#エントリID」になり ID では拾えないため、名前でも照合する(修正ラウンド 2)。前の境目を確かめる。
 */
export function containsStudentNameRef(text, studentNames) {
  const value = String(text ?? '')
  return (studentNames ?? []).flatMap(nameVariants).some((variant) => new RegExp(`${WORD_BEFORE}${escapeRegExp(variant)}#`, 'u').test(value))
}

/**
 * 操作痕跡の文書(entries[])から、要約に「#ID」(または options.studentNames の「名前#」)を含む行だけを取り出す。
 * 名前でだけ当たった行は matchedByName: true。
 */
export function filterStudentTraceEntries(traces, studentId, options = {}) {
  const result = []
  for (const trace of asArray(traces)) {
    for (const entry of asArray(trace?.entries)) {
      if (typeof entry?.summary !== 'string') continue
      const byId = containsStudentRef(entry.summary, studentId)
      const byName = !byId && containsStudentNameRef(entry.summary, options.studentNames)
      if (!byId && !byName) continue
      result.push({ at: String(entry.at ?? ''), kind: String(entry.kind ?? ''), summary: entry.summary, snapshotVersion: trace.snapshotVersion ?? null, saveId: trace.saveId ?? '', matchedByName: byName })
    }
  }
  return result
}

// ---------------------------------------------------------------------------
// 保存ごとの版
// ---------------------------------------------------------------------------

/**
 * 机単位の差(snapshot-diff の diffBoardWeeks)からその生徒(#ID・または options.studentNames の「名前#」)のいる机だけを残す。
 * 名前でだけ当たった机は matchedByName: true。
 */
export function filterStudentDesks(desks, studentId, options = {}) {
  const result = []
  for (const entry of asArray(desks)) {
    if (entry?.scope !== 'desk') continue
    const byId = containsStudentRef(entry.before, studentId) || containsStudentRef(entry.after, studentId)
    const byName = !byId && (containsStudentNameRef(entry.before, options.studentNames) || containsStudentNameRef(entry.after, options.studentNames))
    if (byId || byName) result.push({ ...entry, matchedByName: byName })
  }
  return result
}

const SAVE_HISTORY_NAME_PATTERN = /(?:^|\/)v(\d{8})-(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z\.json\.gz$/

/** 版履歴のファイル名(v{版数8桁}-{保存時刻}.json.gz)から版数・保存時刻・JST の日付を読む。形が違えば null。 */
export function parseSaveHistoryObjectName(name) {
  const match = SAVE_HISTORY_NAME_PATTERN.exec(String(name ?? ''))
  if (!match) return null
  const [, version, date, hh, mm, ss, ms] = match
  const savedAt = `${date}T${hh}:${mm}:${ss}.${ms}Z`
  if (!Number.isFinite(Date.parse(savedAt))) return null
  return { name: String(name), version: Number(version), savedAt, dateKey: toJstDateKey(savedAt) }
}

function compareVersions(left, right) {
  return left.savedAt.localeCompare(right.savedAt) || left.version - right.version
}

/**
 * 落とす版を決める。変化日の最初と最後の版と、**変化日の最初の版の直前の版**(一覧で 1 つ前)だけ
 * (全部の版は落とさない・1 日 60 本ある教室がある)。組の中の版を古い順に隣どうし比べる。
 *
 * ★直前の版を使う理由(2026-11-09 修正ラウンド 2・レビュー指摘): 台帳はその日の最初の保存で必ず送られ、サーバーは
 *   保存ごとにその日の文書を上書きする(src/utils/studentLessonLedger.ts shouldSendStudentLessonLedger・
 *   functions/src/index.ts の台帳の書き込み)。つまり前の台帳日と変化日の間に保存(=版)は無い。暦の前日を見る方式だと
 *   日曜休みの翌月曜などで「前の台帳日の最後 → 変化日の最初」が比べられず、変化日の最初の保存の変化が抜けた。
 * 直前の版が前の組の最後の版と同じなら、組をつなげて同じ版を 2 回落とさない。
 * @param {Array<{ name: string }>} objects Storage の一覧
 * @param {string[]} changeDays 変化日
 * @returns {{ groups: Array<{ days: string[], versions: Array<ReturnType<typeof parseSaveHistoryObjectName>> }>,
 *   dayNotes: Array<{ dateKey: string, note: 'no-versions'|'single-version'|'no-earlier-version' }>, downloads: string[] }}
 */
export function planVersionDownloads(objects, changeDays) {
  const all = asArray(objects).map((object) => parseSaveHistoryObjectName(object?.name)).filter(Boolean).sort(compareVersions)
  const byDay = new Map()
  for (const parsed of all) {
    if (!byDay.has(parsed.dateKey)) byDay.set(parsed.dateKey, [])
    byDay.get(parsed.dateKey).push(parsed)
  }
  const days = [...new Set(asArray(changeDays))].sort()
  const groups = []
  const dayNotes = []
  let current = null
  for (const day of days) {
    const versions = byDay.get(day) ?? []
    if (versions.length === 0) {
      dayNotes.push({ dateKey: day, note: 'no-versions' })
      continue
    }
    const first = versions[0]
    const last = versions[versions.length - 1]
    const firstIndex = all.indexOf(first)
    const anchor = firstIndex > 0 ? all[firstIndex - 1] : null
    if (current && anchor && current.versions[current.versions.length - 1] === anchor) {
      current.days.push(day)
    } else {
      current = { days: [day], versions: anchor ? [anchor] : [] }
      groups.push(current)
      if (!anchor) dayNotes.push({ dateKey: day, note: 'no-earlier-version' })
    }
    current.versions.push(first)
    if (last !== first) current.versions.push(last)
  }
  for (const group of groups) {
    if (group.versions.length === 1) {
      const index = dayNotes.findIndex((note) => note.dateKey === group.days[0] && note.note === 'no-earlier-version')
      if (index >= 0) dayNotes.splice(index, 1)
      dayNotes.push({ dateKey: group.days[0], note: 'single-version' })
    }
  }
  return {
    groups,
    dayNotes,
    downloads: groups.flatMap((group) => group.versions.map((version) => version.name)),
  }
}

// ---------------------------------------------------------------------------
// 1 本にまとめる
// ---------------------------------------------------------------------------

/**
 * 操作ログの detail を「key=値」で並べる。名前を伏せるときは、名前の項目(studentName など)を
 * ID があれば落とし、ID が無ければ名簿で ID に置き換える(名簿に無い名前は「(名簿に無い名前)」にする)。
 */
function formatEventDetail(detail, maskingNames, roster) {
  return Object.entries(detail ?? {})
    .flatMap(([key, value]) => {
      if (!maskingNames || !NAME_DETAIL_KEYS.includes(key) || typeof value !== 'string') return [`${key}=${value}`]
      if (key === 'studentName' && detail.managedStudentId) return []
      const masked = maskNames(value, roster)
      return [`${key}=${masked === value ? '(名簿に無い名前)' : masked}`]
    })
    .join(' ')
}

/** 机の文「講師名: 枠1 / 枠2」の講師名が名簿に無いとき(退職した講師など)、伏せる。 */
function maskDeskTeacher(text, roster) {
  const value = String(text ?? '')
  const separator = value.indexOf(': ')
  if (separator <= 0) return value
  const teacher = value.slice(0, separator)
  if (teacher === '講師なし' || teacher === '(机なし)') return value
  const masked = maskNames(teacher, roster)
  return `${masked === teacher ? '(名簿に無い講師)' : masked}${value.slice(separator)}`
}

/** 机のメモ・注(自由記述)の中身を伏せる(名簿に無い名前が素通しになるため・修正ラウンド 2)。 */
export function maskFreeText(text) {
  return String(text ?? '').replace(/(?<![\p{L}\p{N}])(メモ|注):(.+?)(?= \/ | \+ | → | \| | 注:|$)/gu, '$1:(伏せた)')
}

/** 痕跡の要約(「机N: 講師: 枠 / 枠 → 講師: 枠 / 枠 | …」)の各机の講師名を、名簿に無ければ伏せる。 */
function maskTraceTeachers(summary, roster) {
  return String(summary ?? '').replace(/(机\d+: |→ )([^:|]+?)(?=: )/g, (_match, lead, teacher) => {
    const masked = maskDeskTeacher(`${teacher}: `, roster)
    return `${lead}${masked.slice(0, -2)}`
  })
}

function formatVersionLabel(version, savedAt) {
  const label = typeof version === 'number' ? `v${version}` : '版'
  return savedAt ? `${label}(${formatJstShort(savedAt)})` : label
}

function formatDeskEntry(entry) {
  const where = `${entry.dateKey} ${entry.slotNumber ?? '?'}限 机${entry.deskNumber}`
  if (entry.before === entry.after) return `${where}: 表示は同じ・内部項目が変化 [${entry.after}]`
  return `${where}: ${entry.before} → ${entry.after}`
}

/**
 * 4 つの記録を時刻順に 1 本へ並べる。既定は名前を ID に置き換える(showNames のときだけ名前を残す)。
 * @param {{ studentId: string, roster: Array<{ id: string, name: string, displayName?: string }>, ledgerDays: object[],
 *   events: object[], traces: object[], versionDiffs: Array<{ dateKey: string, fromSavedAt?: string, toSavedAt?: string,
 *   fromVersion?: number, toVersion?: number, desks?: object[], note?: 'no-versions'|'single-version', error?: string }>,
 *   sourceErrors?: Array<{ source: 'ledger'|'event'|'trace'|'version', reason: string }>, showNames?: boolean,
 *   hideTraceSummaries?: boolean }} input
 * @returns {Array<{ at: string, source: 'ledger'|'event'|'trace'|'version', text: string }>}
 */
export function buildStudentTimeline(input) {
  const studentId = input.studentId
  const roster = asArray(input.roster)
  const showNames = Boolean(input.showNames)
  const mask = (text) => (showNames ? text : maskNames(text, roster))
  const entries = []

  for (const error of asArray(input.sourceErrors)) {
    entries.push({ at: '', source: error.source, text: `${SOURCE_LABELS[error.source] ?? error.source}: 取得できず: ${error.reason}` })
  }

  for (const day of summarizeLedgerDays(input.ledgerDays, studentId)) {
    const head = day.kind === 'baseline' ? `台帳 ${day.dateKey} 時点(比べる前の台帳なし)` : day.kind === 'absent' ? `台帳 ${day.dateKey}〜` : `台帳 ${day.dateKey} に変化`
    entries.push({ at: day.savedAt || jstDayStartIso(day.dateKey), source: 'ledger', text: `${head}: ${day.lines.join(' ／ ')}` })
  }

  const studentNames = roster.filter((person) => person.id === studentId).flatMap((person) => [person.name, person.displayName]).filter(Boolean)
  const nameVariantsOfStudent = [...new Set(studentNames.flatMap(nameVariants))].sort((left, right) => right.length - left.length)
  // 名前でだけ当たった行(「名前#エントリID」)は、伏せる前にその生徒の ID を付け直す(名簿外と取り違えない)。
  // 「名前#生徒ID」はそのまま(伏せる処理が ID にする)。
  const rosterIds = new Set(roster.map((person) => person.id))
  const retagByName = (text) => (showNames ? text : nameVariantsOfStudent.reduce((value, variant) => value.replace(
    new RegExp(`${WORD_BEFORE}${escapeRegExp(variant)}#([${ID_CHARS}]+)`, 'gu'),
    (match, id) => (PERSON_ID_PATTERN.test(id) || rosterIds.has(id) ? match : `${studentId}#${id}`),
  ), text))
  const nameMark = (matchedByName) => (matchedByName ? ' (名前で一致)' : '')
  const hideFree = (text) => (showNames ? text : maskFreeText(text))
  const studentDates = collectStudentLedgerDates(input.ledgerDays, studentId)
  for (const event of filterStudentEvents(input.events, studentId, { studentNames, studentDates })) {
    const label = EVENT_KIND_LABELS[event.kind] ?? event.kind
    const displaced = isDisplacedStudentEvent(event, studentId, new Set(nameVariantsOfStudent)) ? '(上書きされた側)' : ''
    const dateWide = !displaced && DATE_WIDE_EVENT_KINDS.has(event.kind) && event.detail?.managedStudentId !== studentId ? '(日付全体)' : ''
    entries.push({ at: String(event.at || event.recordedAt || ''), source: 'event', text: `操作ログ ${label}${displaced}${dateWide}: ${formatEventDetail(event.detail, !showNames, roster)}` })
  }

  for (const entry of filterStudentTraceEntries(input.traces, studentId, { studentNames })) {
    const version = typeof entry.snapshotVersion === 'number' ? ` (保存 v${entry.snapshotVersion})` : ''
    const summary = input.hideTraceSummaries && !showNames
      ? '(名簿が取れないため要約は伏せた・--show-names で見る)'
      : (showNames ? entry.summary : maskTraceTeachers(hideFree(retagByName(entry.summary)), roster))
    entries.push({ at: entry.at, source: 'trace', text: `痕跡 ${entry.kind}: ${summary}${version}${nameMark(entry.matchedByName)}` })
  }

  for (const diff of asArray(input.versionDiffs)) {
    if (diff.error) {
      entries.push({ at: diff.toSavedAt || (diff.dateKey ? jstDayStartIso(diff.dateKey) : ''), source: 'version', text: `版 ${diff.dateKey ?? ''}: 取得できず: ${diff.error}` })
      continue
    }
    if (diff.note === 'no-versions') {
      entries.push({ at: jstDayStartIso(diff.dateKey), source: 'version', text: `版 ${diff.dateKey}: この日の保存の版は無い` })
      continue
    }
    if (diff.note === 'no-earlier-version') {
      entries.push({ at: jstDayStartIso(diff.dateKey), source: 'version', text: `版 ${diff.dateKey}: この日より前の保存の版が無い(この日の最初の保存の変化は比べられない)` })
      continue
    }
    if (diff.note === 'single-version') {
      entries.push({ at: diff.toSavedAt || jstDayStartIso(diff.dateKey), source: 'version', text: `版 ${diff.dateKey}: この日の保存の版は 1 本だけ(比べる相手の版が無い)` })
      continue
    }
    const pair = `${formatVersionLabel(diff.fromVersion, diff.fromSavedAt)} → ${formatVersionLabel(diff.toVersion, diff.toSavedAt)}`
    const desks = filterStudentDesks(diff.desks, studentId, { studentNames })
    const at = diff.toSavedAt || jstDayStartIso(diff.dateKey)
    if (desks.length === 0) {
      entries.push({ at, source: 'version', text: `版 ${pair}: この生徒の机の変化なし` })
      continue
    }
    for (const desk of desks) {
      const hide = (text) => maskDeskTeacher(hideFree(retagByName(text)), roster)
      const shown = showNames ? desk : { ...desk, before: hide(desk.before), after: hide(desk.after) }
      entries.push({ at, source: 'version', text: `版 ${pair}: ${formatDeskEntry(shown)}${nameMark(desk.matchedByName)}` })
    }
  }

  return entries
    .map((entry, index) => ({ ...entry, text: mask(entry.text), index }))
    .sort((left, right) => left.at.localeCompare(right.at) || left.index - right.index)
    .map(({ index: _index, ...entry }) => entry)
}

/**
 * 文字の出力。見出し(教室・生徒・期間・取得の件数)→ 時刻順の 1 行ずつ。
 * @param {{ classroomId: string, studentId: string, from: string, to: string, timeline: ReturnType<typeof buildStudentTimeline>,
 *   stats?: Record<string, string|number>, notes?: string[] }} result
 */
export function formatTimelineText(result) {
  const lines = [`教室 ${result.classroomId} / 生徒 ${result.studentId} / 期間 ${result.from}〜${result.to}(JST)`]
  const stats = Object.entries(result.stats ?? {})
  if (stats.length > 0) lines.push(`取得: ${stats.map(([key, value]) => `${key} ${value}`).join(' / ')}`)
  for (const note of result.notes ?? []) lines.push(`注意: ${note}`)
  lines.push('')
  if (result.timeline.length === 0) lines.push('(この生徒の記録は期間内に 1 件も無い)')
  for (const entry of result.timeline) {
    const when = entry.at ? `${formatJstShort(entry.at)}` : '--   --  '
    lines.push(`${when} [${SOURCE_LABELS[entry.source] ?? entry.source}] ${entry.text}`)
  }
  return lines.join('\n')
}
