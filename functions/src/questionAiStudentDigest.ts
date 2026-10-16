// 質問への AI 即時回答に渡す「質問に名前が出た生徒のいまの数字」(妥協案 B・オーナー採用 2026-10-16 夜)。
//
// 背景: docs/handoff-question-ai-answer.md §7 の 3 案から、オーナーが **B「質問に出た生徒だけ・数字と日付だけ・権威関数の値だけ」** を選んだ。
//  - 教室データ(スナップショット)そのものは AI に渡さない(2026-09-14 の確定は維持)。渡すのは、クライアントが保存時と同じ
//    権威関数(buildMakeupStockEntries / buildLecturePendingItemsByEntryKey ＝ src/utils/studentLessonLedger.ts)で計算した
//    生徒×科目の台帳のうち、**質問文に名前が出た生徒の行だけ**を、人が読める数行にしたもの。
//  - AI に数えさせない(残数・日付はここで確定した値を文字で渡す)。講師名・他の生徒の配置は渡さない。
//  - 質問に出ていない生徒の名前が回答に出たら止める(questionAiAnswer.ts findQuestionAiAnswerViolation の otherStudentNames)。
//
// この 1 ファイルは純関数だけ(SDK・Firestore に触れない)。テストで固定する。

import type { NormalizedDeveloperReportStudentLedger, NormalizedDeveloperReportStudentLedgerRow } from './developerReport'

/** 1 問で数字を渡す生徒の上限(質問文に多数の名前が出ても入力トークンを膨らませない)。 */
export const QUESTION_AI_DIGEST_STUDENT_LIMIT = 3
/** 今後の予定・最近の休みで列挙するコマの上限。 */
export const QUESTION_AI_DIGEST_LESSON_LIMIT = 8
/** 出席回数を数える過去日数。 */
export const QUESTION_AI_DIGEST_ATTENDANCE_DAYS = 30
/** 質問文に生徒名が見つからなかったときに渡す一文(AI はこれを見て数字を作らず、名前の確認を促す)。 */
export const QUESTION_AI_DIGEST_NO_STUDENT_NOTE = '(質問文に名簿の生徒名は見つかりませんでした。生徒ごとの数字は渡していません)'

const LESSON_TYPE_LABELS: Record<string, string> = { regular: '通常', makeup: '振替', special: '講習', extra: '増コマ', trial: '体験' }
const WEEKDAY_LABELS = ['日', '月', '火', '水', '木', '金', '土']

/** 空白(半角・全角)を除いて NFKC 正規化(「山田 太郎」「山田(全角空白)太郎」「山田太郎」を同じに扱う)。 */
export function normalizeStudentNameForMatch(value: string): string {
  return value.normalize('NFKC').replace(/[\s\u3000]+/gu, '')
}

/**
 * 質問文に名前が出ている生徒(表示名)を返す。
 * - フルネーム(空白を除いた形)が質問文に含まれれば一致。
 * - 空白区切りの先頭の語(姓・2 文字以上)だけでも、その姓を持つ生徒が **1 人だけ** なら一致(「山田さんの振替は？」)。
 *   同じ姓が複数いるときは姓だけでは当てない(別人の数字を出さないため)。
 * 戻り値は台帳に出てくる表示名(重複なし・台帳の順)。
 */
export function findStudentsMentionedInQuestion(note: string, names: readonly string[]): string[] {
  const normalizedNote = normalizeStudentNameForMatch(note)
  if (!normalizedNote) return []
  const uniqueNames = [...new Set(names.map((name) => name.trim()).filter((name) => name.length > 0))]
  const matched = new Set<string>()
  for (const name of uniqueNames) {
    const normalized = normalizeStudentNameForMatch(name)
    if (normalized.length >= 2 && normalizedNote.includes(normalized)) matched.add(name)
  }
  const surnameOwners = new Map<string, string[]>()
  for (const name of uniqueNames) {
    const [surname = ''] = name.trim().split(/[\s\u3000]+/u)
    const normalizedSurname = normalizeStudentNameForMatch(surname)
    if (normalizedSurname.length < 2 || normalizedSurname === normalizeStudentNameForMatch(name)) continue
    surnameOwners.set(normalizedSurname, [...(surnameOwners.get(normalizedSurname) ?? []), name])
  }
  for (const [surname, owners] of surnameOwners) {
    if (owners.length === 1 && normalizedNote.includes(surname)) matched.add(owners[0])
  }
  return uniqueNames.filter((name) => matched.has(name))
}

/** 台帳に出てくる表示名(重複なし)。 */
export function collectStudentLedgerNames(ledger: NormalizedDeveloperReportStudentLedger): string[] {
  const names = new Set<string>()
  for (const row of ledger.rows) if (row.name.trim()) names.add(row.name.trim())
  for (const row of ledger.lectureRows) if (row.name.trim()) names.add(row.name.trim())
  return [...names]
}

/** トークン `YYYY-MM-DD#限|種別|元日|元限` を分解する。 */
function parseToken(token: string): { dateKey: string; slot: string; lessonType: string; sourceDate: string; sourceSlot: string } {
  const [head = '', lessonType = '', sourceDate = '', sourceSlot = ''] = token.split('|')
  const [dateKey = '', slot = ''] = head.split('#')
  return { dateKey, slot, lessonType, sourceDate, sourceSlot }
}

/** `2026-10-03` → `10/3(金)`。読めない日付はそのまま返す。 */
export function formatDigestDate(dateKey: string): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(dateKey)
  if (!match) return dateKey
  const [, year, month, day] = match
  const weekday = WEEKDAY_LABELS[new Date(Date.UTC(Number(year), Number(month) - 1, Number(day))).getUTCDay()]
  return `${Number(month)}/${Number(day)}(${weekday})`
}

function formatDateSlot(dateKey: string, slot: string): string {
  return slot ? `${formatDigestDate(dateKey)} ${slot}限` : formatDigestDate(dateKey)
}

function formatLessonToken(token: string, options: { withSource?: boolean } = {}): string {
  const parsed = parseToken(token)
  const type = LESSON_TYPE_LABELS[parsed.lessonType] ?? parsed.lessonType
  const source = options.withSource && parsed.sourceDate && parsed.sourceDate !== parsed.dateKey ? `(元 ${formatDateSlot(parsed.sourceDate, parsed.sourceSlot)})` : ''
  return `${formatDateSlot(parsed.dateKey, parsed.slot)}${type ? ` ${type}` : ''}${source}`
}

/** `YYYY-MM-DD#限|理由` (未消化の元コマ) → `10/3(金) 2限(休み)`。 */
function formatOriginToken(token: string): string {
  const [head = '', reason = ''] = token.split('|')
  const [dateKey = '', slot = ''] = head.split('#')
  return `${formatDateSlot(dateKey, slot)}${reason ? `(${reason})` : ''}`
}

/** 月曜始まりの週で、今日から見て何週先か(0=今週・1=来週・2=再来週・負=過去)。読めない日付は null。 */
export function resolveWeekOffset(dateKey: string, todayKey: string): number | null {
  const parse = (key: string) => {
    const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(key)
    return match ? Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])) : null
  }
  const date = parse(dateKey)
  const today = parse(todayKey)
  if (date === null || today === null) return null
  const dayMs = 24 * 60 * 60 * 1000
  const todayDow = (new Date(today).getUTCDay() + 6) % 7 // 月=0 … 日=6
  const weekStart = today - todayDow * dayMs
  return Math.floor((date - weekStart) / (7 * dayMs))
}

/** 週の印。評価 4 回目(2026-10-16)で Sonnet が「来週」の範囲を数え違えたので、AI に数えさせず印で渡す。 */
export function formatWeekLabel(dateKey: string, todayKey: string): string {
  const offset = resolveWeekOffset(dateKey, todayKey)
  if (offset === null) return ''
  if (offset < 0) return '〔過去〕'
  if (offset === 0) return dateKey === todayKey ? '〔今日〕' : '〔今週〕'
  if (offset === 1) return '〔来週〕'
  if (offset === 2) return '〔再来週〕'
  return '〔それ以降〕'
}

function shiftDateKey(dateKey: string, days: number): string {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(dateKey)
  if (!match) return dateKey
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + days))
  return date.toISOString().slice(0, 10)
}

/** 今日の日付キー(JST)。 */
export function resolveJstDateKey(now: Date): string {
  return new Date(now.getTime() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10)
}

function describeSubjectRow(row: NormalizedDeveloperReportStudentLedgerRow, todayKey: string): string[] {
  const lines: string[] = []
  const remaining = row.makeupRemaining.map(formatOriginToken)
  lines.push(`- ${row.subject || '(科目なし)'}: 未消化振替 残 ${row.makeupBalance} 回${remaining.length > 0 ? `(元コマ: ${remaining.join(' / ')})` : ''}`)
  const upcoming = row.placed
    .filter((token) => parseToken(token).dateKey >= todayKey)
    .sort()
    .slice(0, QUESTION_AI_DIGEST_LESSON_LIMIT)
    .map((token) => `${formatLessonToken(token, { withSource: true })}${formatWeekLabel(parseToken(token).dateKey, todayKey)}`)
  lines.push(`  今日以降の予定(${upcoming.length === 0 ? '盤面に無し' : `近い ${upcoming.length} 件`}): ${upcoming.length > 0 ? upcoming.join(' / ') : '—'}`)
  const recentAbsent = [...row.absent].sort().slice(-QUESTION_AI_DIGEST_LESSON_LIMIT).reverse().map((token) => formatLessonToken(token))
  if (recentAbsent.length > 0) lines.push(`  休み(振替あり・新しい順): ${recentAbsent.join(' / ')}`)
  const recentNoMakeup = [...row.absentNoMakeup].sort().slice(-QUESTION_AI_DIGEST_LESSON_LIMIT).reverse().map((token) => formatLessonToken(token))
  if (recentNoMakeup.length > 0) lines.push(`  振無休(新しい順): ${recentNoMakeup.join(' / ')}`)
  const floorKey = shiftDateKey(todayKey, -QUESTION_AI_DIGEST_ATTENDANCE_DAYS)
  const attendedRecently = row.attended.filter((token) => { const key = parseToken(token).dateKey; return key >= floorKey && key <= todayKey }).length
  lines.push(`  直近 ${QUESTION_AI_DIGEST_ATTENDANCE_DAYS} 日の出席 ${attendedRecently} 回`)
  return lines
}

export type QuestionAiStudentDigest = {
  /** AI に渡す本文(見つからなければ QUESTION_AI_DIGEST_NO_STUDENT_NOTE)。 */
  text: string
  /** 数字を渡した生徒(表示名)。 */
  mentionedNames: string[]
  /** 質問に出ていない生徒の表示名(3 文字以上)。回答に出たら止める。 */
  otherStudentNames: string[]
}

/**
 * 台帳と質問文から、AI に渡す「質問に名前が出た生徒のいまの数字」を作る。
 * 台帳が無い(旧クライアント・質問以外)ときは null。
 */
export function buildQuestionAiStudentDigest(input: { note: string; ledger: NormalizedDeveloperReportStudentLedger | null; now?: Date }): QuestionAiStudentDigest | null {
  if (!input.ledger) return null
  const names = collectStudentLedgerNames(input.ledger)
  const mentioned = findStudentsMentionedInQuestion(input.note, names).slice(0, QUESTION_AI_DIGEST_STUDENT_LIMIT)
  const mentionedSet = new Set(mentioned)
  const otherStudentNames = names.filter((name) => !mentionedSet.has(name) && normalizeStudentNameForMatch(name).length >= 3)
  if (mentioned.length === 0) return { text: QUESTION_AI_DIGEST_NO_STUDENT_NOTE, mentionedNames: [], otherStudentNames }
  const todayKey = resolveJstDateKey(input.now ?? new Date())
  const lines: string[] = [`(今日は ${formatDigestDate(todayKey)}。数字は質問した時点で画面に出ていた状態で、保存前の変更を含みます。週は月曜始まりで、〔今週〕〔来週〕の印はそのまま使い、自分で数え直さない)`]
  for (const name of mentioned) {
    lines.push('', `## ${name}`)
    const rows = input.ledger.rows.filter((row) => row.name.trim() === name).sort((left, right) => left.subject.localeCompare(right.subject, 'ja'))
    if (rows.length === 0) lines.push('- 通常授業・振替の記録は盤面にありません')
    for (const row of rows) lines.push(...describeSubjectRow(row, todayKey))
    const lectureRows = input.ledger.lectureRows.filter((row) => row.name.trim() === name)
    for (const row of lectureRows) {
      const origins = row.origins.map((token) => formatOriginToken(token))
      lines.push(`- 未消化講習: ${row.sessionLabel || '講習'} ${row.subject} 残 ${row.pending} 回${origins.length > 0 ? `(元コマ: ${origins.join(' / ')})` : ''}`)
    }
    if (lectureRows.length === 0) lines.push('- 未消化講習: なし')
  }
  return { text: lines.join('\n'), mentionedNames: mentioned, otherStudentNames }
}
