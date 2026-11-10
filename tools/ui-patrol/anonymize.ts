// 画面の自動巡回(tools/ui-patrol.mjs・docs/test-strategy.md 層 5)の伏せ字。
// 本番の教室データ(AppSnapshotPayload)の生徒・講師・室長の名前を ID から作った仮名へ置き換え、メモ・連絡事項・
// ロゴ・電話・メール・トークン・更新者を消すか偽の値にする。決まりの表は docs/plan-2026-11-11-ui-patrol.md の Task 2 が正本。
//
// ★なぜ「文字列ごとの対応表」で置き換えるか
//   アプリは名前の一致で生徒・講師を引く(buildManagedStudentByAnyNameMap・講師欄の名前と名簿の照合など)。
//   同じ文字列を必ず同じ仮名にし、名簿の登録名・表示名・姓(deriveManagedDisplayName)を先に登録しておけば、
//   伏せ字の前後で「どの文字列がどの生徒・講師に当たるか」の関係が変わらない＝アプリの挙動が変わらない。
//   伏せ字で挙動が変わったまま点検しても意味がないので、呼び出し側は compareAuditForParity で確かめる。
// ★漏れ検査(findNameLeaks)が最後の番人。名前の入る項目の一覧に漏れがあっても、名前が残れば経路で知らせる(値は返さない)。
// ★読み取り専用。入力の payload は書き換えない(複製してから置き換える)。ネットワークにもファイルにも触れない。
import { deriveManagedDisplayName, getStudentDisplayName, type StudentRow } from '../../src/components/basic-data/basicDataModel'
import type { AppSnapshotPayload } from '../../src/types/appState'
import { hasRealDeskTeacher } from '../../src/utils/deskTeacherLabel'
import type { InvAuditFinding, InvAuditResult } from '../invAuditEntry'

export type AnonymizeResult = {
  /** 伏せ字のあと。入力は書き換えない。 */
  payload: AppSnapshotPayload
  /** 実名の文字列 → 仮名。報告・ファイルへ出さない。 */
  nameMap: Map<string, string>
  stats: { students: number; teachers: number; aliases: number; memos: number; cleared: number }
}

const WHITESPACE_RUN = /[\s\u3000]+/u
const WHITESPACE_RUN_GLOBAL = /[\s\u3000]+/gu
const MEMO_TEXT = 'メモ'
const PATROL_SCHOOL_NAME = '巡回用教室'
const PATROL_UPDATED_BY = 'patrol'

/**
 * 盤面(boardState の中・保留の下段を含む)で人の名前を持つ文字列のキー。
 * 2026-11-11 に本番 2 校で数えた一覧(desks[].teacher・studentSlots[].name・statusSlots[].name / teacherName・
 * fallbackMakeupStudents.*.studentName / displayName・manualLectureStockOrigins.*[].displayName・
 * fallbackLectureStockStudents.*.displayName・groupClassEntries.*.teacherName)に、types.ts の DeskCell が持つ講師の写し
 * (templateTeacherShift.teacher・teacherRest.teacher・templateTeacherDeclined.teacher / adopted.teacher・
 * wholeDayPairMovedTeacherFrom.teacher / block.teacher・保留の下段の teacher.teacher)が同じキー名で入る。
 * キー名で拾うので、同じ形の項目はどの深さでも同じ規則になる。
 */
const BOARD_NAME_KEYS = new Set(['name', 'teacher', 'teacherName', 'studentName', 'displayName'])
/**
 * 講師 ID を持つはずだが、本番では名前が入っている机がある項目(teacherAssignmentTeacherId に約 2,100 机)。
 * 名簿の講師 ID と同じならそのまま、違えば名前として対応表で置き換える。teacherId(teacherRest・templateTeacherDeclined・
 * scheduleRegistrationSupersededByTemplate・wholeDayPairMovedTeacherFrom)も同じ作りの写しなので同じ規則にする。
 */
const BOARD_ID_OR_NAME_KEYS = new Set(['teacherAssignmentTeacherId', 'teacherId'])
const TOKEN_KEYS = new Set(['boardShareToken', 'parentPortalToken', 'submissionToken'])

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function stripWhitespace(value: string) {
  return value.replace(WHITESPACE_RUN_GLOBAL, '')
}

function hasInnerWhitespace(value: string) {
  return WHITESPACE_RUN.test(value.trim())
}

function pad3(value: number) {
  return String(value).padStart(3, '0')
}

/**
 * 仮名 alias を、元の文字列 value の空白の形に合わせる(前後の空白と、中の区切りの空白)。
 * 空白を除いた形が同じ名前は、伏せ字のあとも空白を除いた形が同じになる(アプリが空白を詰めて比べる所の関係を保つ)。
 */
function matchWhitespaceShape(value: string, alias: string) {
  const lead = value.match(/^[\s\u3000]*/u)?.[0] ?? ''
  const trail = value.match(/[\s\u3000]*$/u)?.[0] ?? ''
  const core = value.trim()
  const separator = core.match(WHITESPACE_RUN)?.[0]
  let aliasCore: string
  if (!separator) aliasCore = stripWhitespace(alias)
  else if (hasInnerWhitespace(alias)) aliasCore = alias.trim().replace(WHITESPACE_RUN_GLOBAL, separator)
  else aliasCore = alias.trim()
  return `${lead}${aliasCore}${trail}`
}

/** 文字列ごとの対応表。先に登録した文字列が勝つ(同じ文字列は必ず同じ仮名)。 */
class NameTable {
  readonly exact = new Map<string, string>()
  private readonly stripped = new Map<string, string>()
  aliasCount = 0

  register(real: string, pseudo: string) {
    if (!real.trim()) return
    if (!this.exact.has(real)) this.exact.set(real, pseudo)
    const key = stripWhitespace(real)
    if (key && !this.stripped.has(key)) this.stripped.set(key, pseudo)
  }

  resolve(value: string) {
    const hit = this.exact.get(value)
    if (hit !== undefined) return hit
    const sameWithoutSpace = this.stripped.get(stripWhitespace(value))
    if (sameWithoutSpace !== undefined) {
      const shaped = matchWhitespaceShape(value, sameWithoutSpace)
      this.exact.set(value, shaped)
      return shaped
    }
    this.aliasCount += 1
    const alias = `別名${pad3(this.aliasCount)}`
    this.register(value, alias)
    return alias
  }
}

type RosterKind = { full: string; short: string }
const STUDENT_KIND: RosterKind = { full: '生徒', short: '生' }
const TEACHER_KIND: RosterKind = { full: '講師', short: '講' }

/** 名簿の行の番号(ID の数字部分)。数字が無い・他の行と重なる ID は名簿順の X 番号(重なると名前引きの関係が壊れるため)。 */
function buildRosterNumbers(ids: string[]) {
  const used = new Set<string>()
  let xCount = 0
  return ids.map((id) => {
    const digits = typeof id === 'string' ? id.match(/\d+/)?.[0] : undefined
    if (digits && !used.has(digits)) {
      used.add(digits)
      return digits
    }
    xCount += 1
    return `X${pad3(xCount)}`
  })
}

function buildRosterName(kind: RosterKind, number: string, originalName: string) {
  if (!originalName.trim()) return originalName
  return hasInnerWhitespace(originalName) ? `${kind.full}${number}\u3000名` : `${kind.full}${number}`
}

function buildRosterDisplayName(kind: RosterKind, number: string, originalName: string, originalDisplayName: string | undefined) {
  if (typeof originalDisplayName !== 'string' || originalDisplayName === '') return originalDisplayName
  return originalDisplayName === deriveManagedDisplayName(originalName) ? `${kind.full}${number}` : `${kind.short}${number}`
}

type RosterRow = { id: string; name: string; displayName?: string }

/** 名簿の行を伏せ字にし、登録名・表示名・名前引きに使う形(表示名が空なら姓)を対応表へ登録する。 */
function anonymizeRoster<T extends RosterRow>(rows: T[], kind: RosterKind, table: NameTable) {
  const numbers = buildRosterNumbers(rows.map((row) => row.id))
  return rows.map((row, index) => {
    const originalName = typeof row.name === 'string' ? row.name : ''
    const name = buildRosterName(kind, numbers[index], originalName)
    const displayName = buildRosterDisplayName(kind, numbers[index], originalName, row.displayName)
    table.register(originalName, name)
    if (typeof row.displayName === 'string' && typeof displayName === 'string') table.register(row.displayName, displayName)
    // アプリの名前引きは「表示名 → 無ければ姓 → 無ければ登録名」(getStudentDisplayName / getTeacherDisplayName)。
    // 表示名が空の行も、盤面には姓が入るので姓を登録する。
    const before = getStudentDisplayName({ name: originalName, displayName: row.displayName ?? '' } as StudentRow)
    const after = getStudentDisplayName({ name, displayName: displayName ?? '' } as StudentRow)
    table.register(before, after)
    table.register(deriveManagedDisplayName(originalName), deriveManagedDisplayName(name))
    return { ...row, name, ...('displayName' in row ? { displayName } : {}) }
  })
}

type Counters = { memos: number; cleared: number; tokens: Map<string, string> }

function fakeToken(value: string, counters: Counters) {
  const known = counters.tokens.get(value)
  if (known) return known
  const serial = String(counters.tokens.size + 1)
  const fake = `p${serial.padStart(Math.max(0, value.length - 1), '0')}`
  counters.tokens.set(value, fake)
  return fake
}

/** 名簿の外も含め、payload 全体のメールを空に・トークンを偽の値にする(発行元の教室 ID はそのまま)。 */
function scrubContactsAndTokens(value: unknown, counters: Counters): unknown {
  if (Array.isArray(value)) return value.map((item) => scrubContactsAndTokens(item, counters))
  if (!isPlainObject(value)) return value
  const next: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (key === 'email' && typeof child === 'string') {
      if (child !== '') counters.cleared += 1
      next[key] = ''
    } else if (TOKEN_KEYS.has(key) && typeof child === 'string' && child !== '') {
      next[key] = fakeToken(child, counters)
    } else {
      next[key] = scrubContactsAndTokens(child, counters)
    }
  }
  return next
}

function memoize(value: unknown, counters: Counters) {
  if (typeof value !== 'string' || value === '') return value
  counters.memos += 1
  return MEMO_TEXT
}

function replaceBoardName(value: string, table: NameTable) {
  // 空と埋め草(講師未割当・講師未設定)は名前ではない。机の確保(再マージの不動点)に使うのでそのまま。
  if (!hasRealDeskTeacher(value)) return value
  return table.resolve(value)
}

/** 盤面の中を歩き、名前のキーを対応表で、メモを「メモ」に置き換える。 */
function anonymizeBoardValue(value: unknown, table: NameTable, teacherIds: Set<string>, counters: Counters): unknown {
  if (Array.isArray(value)) return value.map((item) => anonymizeBoardValue(item, table, teacherIds, counters))
  if (!isPlainObject(value)) return value
  const next: Record<string, unknown> = {}
  for (const [key, child] of Object.entries(value)) {
    if (typeof child === 'string' && BOARD_NAME_KEYS.has(key)) {
      next[key] = replaceBoardName(child, table)
    } else if (typeof child === 'string' && BOARD_ID_OR_NAME_KEYS.has(key)) {
      next[key] = teacherIds.has(child) ? child : replaceBoardName(child, table)
    } else if (key === 'memoSlots' && Array.isArray(child)) {
      next[key] = child.map((memo) => memoize(memo, counters))
    } else if (key === 'wholeDayPairMovedMemoFrom' && Array.isArray(child)) {
      // 付け替えで移したメモの写し(席ごとの本文)。メモと同じく本文を伏せる。
      next[key] = child.map((entry) => (isPlainObject(entry) ? { ...entry, text: memoize(entry.text, counters) } : entry))
    } else {
      next[key] = anonymizeBoardValue(child, table, teacherIds, counters)
    }
  }
  return next
}

function anonymizeClassroomSettings(settings: unknown, counters: Counters) {
  if (!isPlainObject(settings)) return settings
  const next: Record<string, unknown> = { ...settings }
  if (isPlainObject(settings.scheduleNotes)) {
    next.scheduleNotes = Object.fromEntries(Object.entries(settings.scheduleNotes).map(([key, note]) => [key, memoize(note, counters)]))
  }
  if (isPlainObject(settings.scheduleHeader)) {
    const header: Record<string, unknown> = { ...settings.scheduleHeader }
    for (const key of ['logoDataUrl', 'phoneNumber']) {
      if (typeof header[key] === 'string') {
        if (header[key] !== '') counters.cleared += 1
        header[key] = ''
      }
    }
    if (typeof header.schoolName === 'string' && header.schoolName !== '') header.schoolName = PATROL_SCHOOL_NAME
    next.scheduleHeader = header
  }
  if ('updatedBy' in settings) next.updatedBy = PATROL_UPDATED_BY
  return next
}

export function anonymizeClassroomPayload(payload: AppSnapshotPayload): AnonymizeResult {
  // 入力を書き換えないよう、最初に丸ごと複製する(以降の置き換えはすべて新しいオブジェクトを作る)。
  const source = structuredClone(payload) as AppSnapshotPayload
  const table = new NameTable()
  const counters: Counters = { memos: 0, cleared: 0, tokens: new Map() }
  const students = Array.isArray(source.students) ? source.students : []
  const teachers = Array.isArray(source.teachers) ? source.teachers : []
  const managers = Array.isArray(source.managers) ? source.managers : []

  // 名簿を先に登録する(生徒 → 講師 → 室長の順・先に登録した文字列が勝つ)。
  const nextStudents = anonymizeRoster(students, STUDENT_KIND, table)
  const nextTeachers = anonymizeRoster(teachers, TEACHER_KIND, table).map((row) => (
    'memo' in row ? { ...row, memo: memoize((row as { memo?: unknown }).memo, counters) } : row
  ))
  const nextManagers = managers.map((row, index) => {
    const name = `室長${index + 1}`
    if (typeof row.name === 'string') table.register(row.name, name)
    return { ...row, name }
  })

  const teacherIds = new Set(teachers.map((row) => row.id).filter((id): id is string => typeof id === 'string' && id !== ''))
  const boardState = source.boardState ? anonymizeBoardValue(source.boardState, table, teacherIds, counters) : source.boardState

  const replaced = {
    ...source,
    students: Array.isArray(source.students) ? nextStudents : source.students,
    teachers: Array.isArray(source.teachers) ? nextTeachers : source.teachers,
    managers: Array.isArray(source.managers) ? nextManagers : source.managers,
    classroomSettings: anonymizeClassroomSettings(source.classroomSettings, counters),
    boardState,
  }
  const scrubbed = scrubContactsAndTokens(replaced, counters) as AppSnapshotPayload
  return {
    payload: scrubbed,
    nameMap: new Map(table.exact),
    stats: { students: students.length, teachers: teachers.length, aliases: table.aliasCount, memos: counters.memos, cleared: counters.cleared },
  }
}

const IDENTIFIER_KEY = /^[A-Za-z_$][\w$]*$/

/** 伏せ字のあとに実名が残っている項目の経路(値は返さない)。空なら漏れなし。 */
export function findNameLeaks(anonymized: unknown, realNames: Iterable<string>): string[] {
  // 実名の断片 = 名前そのもの＋空白で分けた 2 文字以上の部分。2 文字以上は「含む」でも拾う(1 文字は完全一致だけ)。
  const exactFragments = new Set<string>()
  const containFragments = new Set<string>()
  for (const raw of realNames) {
    if (typeof raw !== 'string') continue
    const name = raw.trim()
    if (!name) continue
    const parts = [name, ...name.split(WHITESPACE_RUN).filter((part) => part.length >= 2)]
    for (const part of parts) {
      exactFragments.add(part)
      if (part.length >= 2) containFragments.add(part)
    }
  }
  const contains = [...containFragments]
  // 本番の盤面は同じ文字列が何万回も出るので、文字列ごとの判定を覚えておく。
  const cache = new Map<string, boolean>()
  const leaks = (text: string) => {
    const known = cache.get(text)
    if (known !== undefined) return known
    const result = exactFragments.has(text) || exactFragments.has(text.trim()) || contains.some((fragment) => text.includes(fragment))
    cache.set(text, result)
    return result
  }
  const found = new Set<string>()
  const walk = (value: unknown, path: string) => {
    if (typeof value === 'string') {
      if (leaks(value)) found.add(path || '(ルート)')
      return
    }
    if (Array.isArray(value)) {
      for (const item of value) walk(item, `${path}[]`)
      return
    }
    if (!isPlainObject(value)) return
    for (const [key, child] of Object.entries(value)) {
      const keyLeaks = leaks(key)
      if (keyLeaks) found.add(`${path ? `${path}.` : ''}*(キー)`)
      // 経路に値を出さない: 識別子の形のキーだけ名前を書き、ほか(日付・生徒の鍵など動くキー)は * にまとめる。
      const segment = !keyLeaks && IDENTIFIER_KEY.test(key) ? key : '*'
      walk(child, path ? `${path}.${segment}` : segment)
    }
  }
  walk(anonymized, '')
  return [...found].sort()
}

const FINDING_TUPLE_KEYS = ['rule', 'severity', 'kind', 'studentId', 'dateKey', 'slotNumber', 'deskIndex', 'subject', 'sessionId', 'period'] as const

function findingTuple(finding: InvAuditFinding) {
  return JSON.stringify(FINDING_TUPLE_KEYS.map((key) => finding[key] ?? null))
}

function countTuples(findings: InvAuditFinding[]) {
  const counts = new Map<string, number>()
  for (const finding of findings) {
    const tuple = findingTuple(finding)
    counts.set(tuple, (counts.get(tuple) ?? 0) + 1)
  }
  return counts
}

/** 伏せ字の前後で保証台帳の洗い出しの結果が同じか。食い違いの説明(空なら一致)。message は名前の入りうる文なので比べない。 */
export function compareAuditForParity(real: InvAuditResult, anonymized: InvAuditResult): string[] {
  const differences: string[] = []
  const realCounts = real.counts ?? {}
  const anonymizedCounts = anonymized.counts ?? {}
  const keys = [...new Set([...Object.keys(realCounts), ...Object.keys(anonymizedCounts)])].sort()
  for (const key of keys) {
    if (realCounts[key] !== anonymizedCounts[key]) differences.push(`件数 ${key}: 伏せ字の前 ${realCounts[key] ?? '(無し)'} → 後 ${anonymizedCounts[key] ?? '(無し)'}`)
  }
  const realTuples = countTuples(real.findings ?? [])
  const anonymizedTuples = countTuples(anonymized.findings ?? [])
  const describeOnly = (label: string, from: Map<string, number>, other: Map<string, number>) => {
    const only: string[] = []
    for (const [tuple, count] of from) {
      const extra = count - (other.get(tuple) ?? 0)
      for (let index = 0; index < extra; index += 1) only.push(tuple)
    }
    if (only.length === 0) return
    only.sort()
    // 所見の組は ID・日付・科目だけ(名前は入らない)。長くなりすぎないよう 5 件まで。
    differences.push(`所見が${label}だけに ${only.length} 件: ${only.slice(0, 5).join(' / ')}${only.length > 5 ? ' …' : ''}`)
  }
  describeOnly('伏せ字の前', realTuples, anonymizedTuples)
  describeOnly('伏せ字の後', anonymizedTuples, realTuples)
  return differences
}
