// 画面の自動巡回(tools/ui-patrol.mjs・docs/test-strategy.md 層 5「操作のたびの点検」)の盤面の事実。
// 操作の前後の教室データ(AppSnapshotPayload)を、盤面の「意味」に直して比べられる形にする。
//
// ★比べるのは意味だけ(本物の講師・生徒・科目・授業の種類・出自〔テンプレ／手入力〕・出欠記録・メモ・保留の下段)。
//   保存→読み込み直しで生徒の origin の印が 1,000 件単位で付け直される(付いていない ↔ 'template')ことが本番の形で分かっている。
//   印そのものを比べると読み込み直しのたびに「変わった」と出て点検にならないので、出自は権威関数 resolveStudentOrigin を通した結果で持つ。
//   同じ理由で lesson.id・机の id・manualTeacher・teacherAssignmentSource・teacherAssignmentTeacherId は生で持たない
//   (講師は「本物の講師名」と「講師の出自＝resolveDeskTeacherOrigin の結果」で持つ)。
// ★判定はアプリの権威関数を呼ぶだけ(出自＝placementOrigin.ts・講師なし＝hasRealDeskTeacher・講師の休み＝hasDeskTeacherRest・
//   保留＝normalizeTemplatePendingDeskMap / parseTemplatePendingDeskKey)。ここで規則を書き直さない(二重管理にしない)。
// ★読み取り専用。入力は書き換えない。ネットワークにもファイルにも触れない。
// ★性能: 1 教室で机が約 2 万・操作ごとに 2 回呼ぶ。署名の JSON 化は机ごとに 1 回だけ。
import { resolveDeskTeacherOrigin, resolveStudentOrigin } from '../../src/components/schedule-board/placementOrigin'
import { hasDeskTeacherRest, isTeacherRestedInCell } from '../../src/components/schedule-board/teacherRest'
import { normalizeTemplatePendingDeskMap, parseTemplatePendingDeskKey, type TemplatePendingLower } from '../../src/components/schedule-board/templatePendingDesks'
import type { DeskCell, SlotCell, StudentEntry, StudentStatusEntry } from '../../src/components/schedule-board/types'
import type { AppSnapshotPayload } from '../../src/types/appState'
import { hasRealDeskTeacher } from '../../src/utils/deskTeacherLabel'
import { buildTeacherAliasResolver, isTeacherElsewhereInCell, isTemplateDiffTeacherTombstone, type TeacherAliasResolver } from '../../src/components/schedule-board/templateDiffApply'

/** key＝managedStudentId、無ければ 'name:' + name(盤面の比べ方と同じく、名簿に結べない生徒は名前で数える)。 */
export type StudentFact = { key: string; name: string; subject: string; lessonType: string; origin: 'template' | 'manual' }

export type DeskFact = {
  /** `${cellId}#${deskIndex}` */
  key: string
  cellId: string
  dateKey: string
  slotNumber: number
  deskIndex: number
  /** 本物の講師名(空・埋め草は '')。 */
  teacher: string
  teacherOrigin: 'template' | 'manual' | null
  /** 講師の休みの机。 */
  teacherRest: boolean
  /**
   * 休みにした講師の名前(休みでなければ '')。盤面は「休 講師A」と名前を出すので、休みの講師が替わったのも意味の違い
   * (修正 1・レビュー Minor 1)。名前が無く ID だけの記録は ID で持つ。
   */
  teacherRestName: string
  /**
   * 室長が講師を消した記録のある机(講師欄が空 ∧ teacherAssignmentSource='deleted')。講習 ID つきも同じ。
   * ★権威は templateDiffApply.ts の isTemplateDiffTeacherTombstone(「講師欄の」削除記録＝机に生徒が居ても講師欄を削除のまま保つ判定。
   *   テンプレ保存〔差分反映〕が「講師を消した机には講師を置かない・テンプレの生徒は置く」を決めるのもこの判定)。
   *   ScheduleBoardScreen.tsx の isDeletedTeacherTombstone は「授業なし ∧ manualTeacher ∧ deleted」＝空き机としての判定(詰め直し・
   *   講習の自動割当用)で、生徒が居る机では偽になるので使わない(両者は別の目的で、templateDiffApply.ts のコメントも統一を禁じている)。
   * ★署名(signature)・changedFields には入れない: 比べる中身を変えない。この印は点検が「なぜ講師がいないか」を読むための注釈で、
   *   保存→読み込み直しで付け直されうる内部の印(teacherAssignmentSource)を比べると「変わった」と誤報するため(origin と同じ考え)。
   */
  teacherDeleted: boolean
  /** コマが開いている日か(休日でない・SlotCell.isOpenDay)。署名の外(比べない・保留の数の点検が使う注釈)。 */
  cellOpen: boolean
  /** この机に保留(2 行)の記録がある(templatePendingDesks に机の鍵がある・下段の中身が空でも)。署名の外。 */
  pendingRecorded: boolean
  /** 席 0・席 1。 */
  students: Array<StudentFact | null>
  /** 出欠記録 1 件 1 文字列(生徒キー|status|科目|種類)。並べ替え済み。 */
  statuses: string[]
  /** 空でないメモ。並べ替え済み。 */
  memos: string[]
  /** 保留(2 行)の下段の生徒。下段は手入力の側(spec-template-conflict-v2「2 行の席: 上段(テンプレ)／下段(手入力)」)。 */
  pendingStudents: StudentFact[]
  /** 保留の下段の講師(無ければ '')。 */
  pendingTeacher: string
  /**
   * 保留の下段の出欠記録・メモ(要件の型への追加・task-3-report の「自分で決めた点」1)。
   * 席が足りないとき出欠記録・メモも下段へ移る(templatePendingDesks.ts の TemplatePendingLower)。持たないと、下段へ移っただけの記録を
   * 「消えた」と誤って止め、下段から本当に消えた記録は見逃す。形は statuses / memos と同じ。
   */
  pendingStatuses: string[]
  pendingMemos: string[]
  /** 上の中身(位置の項目以外)の JSON。比べるのはこれ。 */
  signature: string
}

/**
 * 講師のコマの形のうち、点検が「変」として見る 2 つ(台本 f・2026-11-11)。机の事実(署名)の外の注釈(比べる中身を変えない)。
 * - rested-present: 休みの記録があるコマに、その講師本人が居る(spec-template-conflict-v2 §9-25「手で置いたらそのコマの休みを全部消す」の裏返し)。
 *   判定は teacherRest.ts の isTeacherRestedInCell(呼び名の対応表は buildTeacherAliasResolver)。道具の側に別の照合を作らない。
 * - duplicate: 同じ講師が 1 コマに 2 机(INV-01)。判定は templateDiffApply.ts の isTeacherElsewhereInCell(Q41-6/-7 と同じ)。
 * 休校のコマ・埋め草(講師未割当)の机は数えない。teacher は居る机の講師欄の名前(伏せ字のあとの仮名)。
 */
export type TeacherCellAnomaly = { kind: 'rested-present' | 'duplicate'; cellId: string; dateKey: string; slotNumber: number; deskIndex: number; teacher: string }

export type BoardFacts = { desks: Map<string, DeskFact>; sections: Record<string, string>; pendingDeskCount: number; teacherAnomalies: TeacherCellAnomaly[] }

/** 盤面の机以外で比べる部分(並びは差分の返す順)。 */
export const BOARD_FACT_SECTIONS: readonly string[] = [
  'students',
  'teachers',
  'managers',
  'regularLessons',
  'groupLessons',
  'specialSessions',
  'autoAssignRules',
  'pairConstraints',
  'classroomSettings.template',
  'classroomSettings.other',
  'boardState.suppressedRegularLessonOccurrences',
  'boardState.scheduleCountAdjustments',
  'boardState.manualMakeupAdjustments',
  'boardState.suppressedMakeupOrigins',
  'boardState.fallbackMakeupStudents',
  'boardState.manualLectureStockCounts',
  'boardState.manualLectureStockOrigins',
  'boardState.fallbackLectureStockStudents',
  'boardState.groupClassEntries',
  // 盤面の週に無い机を指す保留(キーはあるが机が weeks に無い)。机の事実に現れないので、ここで比べる(修正 1・レビュー Minor 4)。
  // 消しても pendingDeskCount しか動かず、同じ状態の点検が気づかなかった。
  'boardState.templatePendingDesks.unmatched',
]

/** 教室設定のうちテンプレの部分。テンプレ保存はここだけを変えてよい、と台本が言えるように分ける。 */
const TEMPLATE_SETTING_KEYS = new Set(['regularLessonTemplate', 'regularLessonTemplateHistory', 'preTemplateRegularLessons', 'templateFreezeBeforeDate'])
/** 保存のたびに変わる時刻。比べない。 */
const IGNORED_SETTING_KEYS = new Set(['savedAt', 'updatedAt'])

export type DeskChangeField = 'teacher' | 'students' | 'statuses' | 'memos' | 'pending'
export type DeskChange = { key: string; before: DeskFact | null; after: DeskFact | null; fields: DeskChangeField[] }

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value)
}

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

/** tools/invAuditEntry.ts の normalizeWeeks と同じ読み方(週は SlotCell[] のことも { cells } のこともある)。 */
function normalizeWeeks(value: unknown): SlotCell[][] {
  return asArray<unknown>(value).map((week) => {
    if (Array.isArray(week)) return week as SlotCell[]
    return isPlainObject(week) && Array.isArray(week.cells) ? (week.cells as SlotCell[]) : []
  })
}

/** キーを並べ替えた JSON(部分の署名)。undefined は JSON と同じく落とす。 */
function stableStringify(value: unknown): string {
  if (value === undefined) return 'null'
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map((item) => (item === undefined ? 'null' : stableStringify(item))).join(',')}]`
  const record = value as Record<string, unknown>
  const keys = Object.keys(record).filter((key) => record[key] !== undefined).sort()
  return `{${keys.map((key) => `${JSON.stringify(key)}:${stableStringify(record[key])}`).join(',')}}`
}

/**
 * 部分の署名。無い・null・空の配列・空のオブジェクトは同じ「中身なし」として扱う
 * (保存や読み込み直しで省略できる項目が {} や [] で現れても、意味は変わらないため・task-3-report の「自分で決めた点」2)。
 */
function sectionSignature(value: unknown): string {
  if (value == null) return 'null'
  if (Array.isArray(value) && value.length === 0) return 'null'
  if (isPlainObject(value) && Object.keys(value).every((key) => value[key] === undefined)) return 'null'
  return stableStringify(value)
}

function studentKeyOf(student: Pick<StudentEntry, 'managedStudentId' | 'name'>): string {
  return student.managedStudentId ? student.managedStudentId : `name:${student.name ?? ''}`
}

function toStudentFact(student: StudentEntry): StudentFact {
  // 出自は権威関数の結果だけを持つ(印そのものは持たない＝付け直しで署名が変わらない)。
  return { key: studentKeyOf(student), name: student.name ?? '', subject: student.subject ?? '', lessonType: student.lessonType ?? '', origin: resolveStudentOrigin(student) }
}

function toStatusFacts(slots: ReadonlyArray<StudentStatusEntry | null | undefined> | undefined): string[] {
  return asArray<StudentStatusEntry | null>(slots)
    .filter((status): status is StudentStatusEntry => isPlainObject(status))
    .map((status) => `${studentKeyOf(status)}|${status.status ?? ''}|${status.subject ?? ''}|${status.lessonType ?? ''}`)
    .sort()
}

function toMemoFacts(slots: ReadonlyArray<string | null | undefined> | undefined): string[] {
  return asArray<string | null>(slots).filter((memo): memo is string => typeof memo === 'string' && memo.trim() !== '').sort()
}

function toSeatFacts(slots: ReadonlyArray<StudentEntry | null | undefined> | undefined): Array<StudentFact | null> {
  const list = asArray<StudentEntry | null>(slots)
  return [0, 1].map((index) => (isPlainObject(list[index]) ? toStudentFact(list[index] as StudentEntry) : null))
}

function realTeacherName(teacher: unknown): string {
  return typeof teacher === 'string' && hasRealDeskTeacher(teacher) ? teacher.trim() : ''
}

function buildDeskFact(cell: SlotCell, desk: DeskCell, deskIndex: number, lower: TemplatePendingLower | undefined): DeskFact {
  const teacher = realTeacherName(desk.teacher)
  // 講師が居ない(空・埋め草)なら出自も無い。埋め草に印が付いていても講師として数えない(resolveDeskTeacherOrigin と同じ考え・2026-11-07)。
  const teacherOrigin = teacher ? resolveDeskTeacherOrigin({ teacher: desk.teacher, manualTeacher: desk.manualTeacher, teacherAssignmentSource: desk.teacherAssignmentSource }) : null
  const content = {
    teacher,
    teacherOrigin,
    teacherRest: hasDeskTeacherRest(desk),
    teacherRestName: hasDeskTeacherRest(desk) ? (desk.teacherRest!.teacher.trim() || desk.teacherRest!.teacherId?.trim() || '') : '',
    students: toSeatFacts(desk.lesson?.studentSlots),
    statuses: toStatusFacts(desk.statusSlots),
    memos: toMemoFacts(desk.memoSlots),
    pendingStudents: asArray<StudentEntry | null>(lower?.lesson?.studentSlots).filter((student): student is StudentEntry => isPlainObject(student)).map(toStudentFact),
    pendingTeacher: realTeacherName(lower?.teacher?.teacher),
    pendingStatuses: toStatusFacts(lower?.statusSlots),
    pendingMemos: toMemoFacts(lower?.memoSlots),
  }
  return {
    key: `${cell.id}#${deskIndex}`,
    cellId: cell.id,
    dateKey: cell.dateKey,
    slotNumber: cell.slotNumber,
    deskIndex,
    ...content,
    // 署名(content)の外。content に入れると JSON.stringify の署名に混ざる。
    teacherDeleted: typeof desk.teacher === 'string' && isTemplateDiffTeacherTombstone({ teacher: desk.teacher, teacherAssignmentSource: desk.teacherAssignmentSource }),
    cellOpen: cell.isOpenDay !== false,
    pendingRecorded: lower !== undefined,
    signature: JSON.stringify(content),
  }
}

/** 机に結べなかった保留の中身(机の事実と同じ意味の形・内部の印は持たない)。 */
function toUnmatchedPendingFact(lower: TemplatePendingLower) {
  return {
    students: asArray<StudentEntry | null>(lower.lesson?.studentSlots).filter((student): student is StudentEntry => isPlainObject(student)).map(toStudentFact),
    teacher: realTeacherName(lower.teacher?.teacher),
    statuses: toStatusFacts(lower.statusSlots),
    memos: toMemoFacts(lower.memoSlots),
  }
}

function collectSections(payload: Partial<AppSnapshotPayload>, unmatchedPending: Record<string, unknown>): Record<string, string> {
  const settings = isPlainObject(payload.classroomSettings) ? payload.classroomSettings : {}
  const template: Record<string, unknown> = {}
  const other: Record<string, unknown> = {}
  for (const [key, value] of Object.entries(settings)) {
    if (IGNORED_SETTING_KEYS.has(key)) continue
    if (TEMPLATE_SETTING_KEYS.has(key)) template[key] = value
    else other[key] = value
  }
  const boardState = (isPlainObject(payload.boardState) ? payload.boardState : {}) as Record<string, unknown>
  const record = payload as Record<string, unknown>
  const sections: Record<string, string> = {}
  for (const name of BOARD_FACT_SECTIONS) {
    let value: unknown
    if (name === 'classroomSettings.template') value = template
    else if (name === 'classroomSettings.other') value = other
    else if (name === 'boardState.templatePendingDesks.unmatched') value = unmatchedPending
    else if (name.startsWith('boardState.')) value = boardState[name.slice('boardState.'.length)]
    else value = record[name]
    sections[name] = sectionSignature(value)
  }
  return sections
}

function collectTeacherCellAnomalies(weeks: SlotCell[][], aliases: TeacherAliasResolver): TeacherCellAnomaly[] {
  const anomalies: TeacherCellAnomaly[] = []
  for (const week of weeks) {
    for (const cell of week) {
      if (!isPlainObject(cell) || typeof cell.id !== 'string' || cell.isOpenDay === false) continue
      const desks = asArray<DeskCell>(cell.desks).filter((desk) => isPlainObject(desk) && typeof desk.teacher === 'string')
      const hasRest = desks.some((desk) => hasDeskTeacherRest(desk))
      asArray<DeskCell>(cell.desks).forEach((desk, deskIndex) => {
        if (!isPlainObject(desk) || typeof desk.teacher !== 'string' || !hasRealDeskTeacher(desk.teacher)) return
        const base = { cellId: cell.id, dateKey: cell.dateKey, slotNumber: cell.slotNumber, deskIndex, teacher: desk.teacher.trim() }
        if (hasRest && isTeacherRestedInCell({ desks }, desk, aliases)) anomalies.push({ kind: 'rested-present', ...base })
        if (isTeacherElsewhereInCell({ desks }, desk.id, desk, aliases)) anomalies.push({ kind: 'duplicate', ...base })
      })
    }
  }
  return anomalies
}

export function collectBoardFacts(payload: AppSnapshotPayload): BoardFacts {
  const safePayload = (isPlainObject(payload) ? payload : {}) as Partial<AppSnapshotPayload>
  const boardState = isPlainObject(safePayload.boardState) ? safePayload.boardState : null
  const weeks = normalizeWeeks(boardState?.weeks)
  const pendingMap = normalizeTemplatePendingDeskMap(boardState?.templatePendingDesks)
  // 保留のキーは "<cellId>::<deskId>"。机との対応は盤面の机の id で付ける。
  const lowerByCellDesk = new Map<string, TemplatePendingLower>()
  for (const [pendingKey, entry] of Object.entries(pendingMap)) {
    const parsed = parseTemplatePendingDeskKey(pendingKey)
    if (parsed) lowerByCellDesk.set(`${parsed.cellId}\u0000${parsed.deskId}`, entry.lower)
  }
  const desks = new Map<string, DeskFact>()
  const matchedCellDesks = new Set<string>()
  for (const week of weeks) {
    for (const cell of week) {
      if (!isPlainObject(cell) || typeof cell.id !== 'string') continue
      asArray<DeskCell>(cell.desks).forEach((desk, deskIndex) => {
        if (!isPlainObject(desk)) return
        const cellDeskKey = `${cell.id}\u0000${desk.id}`
        const lower = typeof desk.id === 'string' ? lowerByCellDesk.get(cellDeskKey) : undefined
        if (lower) matchedCellDesks.add(cellDeskKey)
        const fact = buildDeskFact(cell, desk, deskIndex, lower)
        desks.set(fact.key, fact)
      })
    }
  }
  const unmatchedPending: Record<string, unknown> = {}
  for (const [pendingKey, entry] of Object.entries(pendingMap)) {
    const parsed = parseTemplatePendingDeskKey(pendingKey)
    if (parsed && matchedCellDesks.has(`${parsed.cellId}\u0000${parsed.deskId}`)) continue
    unmatchedPending[pendingKey] = toUnmatchedPendingFact(entry.lower)
  }
  const teachers = asArray<{ id?: unknown; name?: unknown; displayName?: unknown }>(safePayload.teachers)
    .filter((row) => isPlainObject(row) && typeof row.id === 'string')
    .map((row) => ({ id: row.id as string, name: typeof row.name === 'string' ? row.name : '', ...(typeof row.displayName === 'string' ? { displayName: row.displayName } : {}) }))
  return {
    desks,
    sections: collectSections(safePayload, unmatchedPending),
    pendingDeskCount: Object.keys(pendingMap).length,
    teacherAnomalies: collectTeacherCellAnomalies(weeks, buildTeacherAliasResolver(teachers)),
  }
}

/**
 * 反映日以降の開いている日のコマで、保留(2 行)の記録がある机の数。テンプレ保存の確認の画面の「保留 n机」と同じ数え方
 * (templateConflictRules.ts の computeTemplateDiffApply: 反映日以降のコマを applyCell に通し、休日のコマは飛ばし、机ごとに保留が残れば summary.pending を 1 足す
 * ＝新しく作った保留と保存し直した保留の両方)。机に結べない保留(週に無い机)は数えない。
 */
export function countPendingDesksFrom(facts: BoardFacts, fromDateKey: string): number {
  let count = 0
  for (const desk of facts.desks.values()) if (desk.pendingRecorded && desk.cellOpen && desk.dateKey >= fromDateKey) count += 1
  return count
}

export function isEmptyDeskFact(fact: DeskFact): boolean {
  return fact.teacher === ''
    && !fact.teacherRest
    && fact.students.every((student) => student === null)
    && fact.statuses.length === 0
    && fact.memos.length === 0
    && fact.pendingStudents.length === 0
    && fact.pendingTeacher === ''
    && fact.pendingStatuses.length === 0
    && fact.pendingMemos.length === 0
}

const json = (value: unknown) => JSON.stringify(value)

function changedFields(before: DeskFact | null, after: DeskFact | null): DeskChangeField[] {
  // 片方にしか無い机は、無い側を「中身なし」として項目を比べる。
  const pick = (fact: DeskFact | null) => ({
    teacher: fact ? json([fact.teacher, fact.teacherOrigin, fact.teacherRest, fact.teacherRestName]) : json(['', null, false, '']),
    students: fact ? json(fact.students) : json([null, null]),
    statuses: fact ? json(fact.statuses) : '[]',
    memos: fact ? json(fact.memos) : '[]',
    pending: fact ? json([fact.pendingStudents, fact.pendingTeacher, fact.pendingStatuses, fact.pendingMemos]) : json([[], '', [], []]),
  })
  const left = pick(before)
  const right = pick(after)
  return (['teacher', 'students', 'statuses', 'memos', 'pending'] as const).filter((field) => left[field] !== right[field])
}

function compareDeskPosition(left: DeskFact, right: DeskFact): number {
  return left.dateKey.localeCompare(right.dateKey) || left.slotNumber - right.slotNumber || left.cellId.localeCompare(right.cellId) || left.deskIndex - right.deskIndex
}

export function diffBoardFacts(before: BoardFacts, after: BoardFacts): { desks: DeskChange[]; sections: string[] } {
  const changes: DeskChange[] = []
  const keys = new Set<string>([...before.desks.keys(), ...after.desks.keys()])
  for (const key of keys) {
    const left = before.desks.get(key) ?? null
    const right = after.desks.get(key) ?? null
    if (left && right) {
      if (left.signature === right.signature) continue
    } else {
      // 片方にしか無い机は、中身が空なら数えない(机の数を変えただけ・空き机の足し引き)。
      const only = (left ?? right)!
      if (isEmptyDeskFact(only)) continue
    }
    const fields = changedFields(left, right)
    if (fields.length === 0) continue
    changes.push({ key, before: left, after: right, fields })
  }
  changes.sort((leftChange, rightChange) => compareDeskPosition((leftChange.after ?? leftChange.before)!, (rightChange.after ?? rightChange.before)!))
  const sections = BOARD_FACT_SECTIONS.filter((name) => (before.sections[name] ?? 'null') !== (after.sections[name] ?? 'null'))
  return { desks: changes, sections }
}
