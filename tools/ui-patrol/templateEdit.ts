// 画面の自動巡回(tools/ui-patrol.mjs・docs/test-strategy.md 層 5)の台本 d「テンプレを実際に変えて保存」の候補選び。
// どのテンプレの机・席を変えるか、どの生徒・講師を選ぶかを、種つきの乱数(呼び出し側が渡す random)で決める(同じ種なら同じ結果＝再現できる)。
//
// ★テンプレ作成の画面の机は、アプリが画面を開くときと同じ権威関数で作る(resolveTemplateDiffBaseline・ScheduleBoardScreen.tsx の
//   handleEnterTemplateMode → buildTemplateBoardCells)。セルは template_{曜日}_{時限}、机は 0 始まり(テンプレの deskIndex - 1)。
// ★変える机は「盤面で前の版のその机が当たっていて、その机に手入力が無い」ものだけを選ぶ(spec-template-conflict-v2 §2-1 の
//   「手入力は講師について行く」・§2-3 の合流・§2-4 の休みが働く形を避け、起きるはずの変化を素直に確かめられる机にする)。
//   手入力のある机でのテンプレ保存は、台本 a(何も変えない保存)と点検(checks.ts)が見る。
// ★純関数。入力を書き換えない。ネットワークにもファイルにも触れない。
import { getTeacherDisplayName, type StudentRow, type TeacherRow } from '../../src/components/basic-data/basicDataModel'
import { resolveTemplateDiffBaseline, type RegularLessonTemplate } from '../../src/components/regular-template/regularLessonTemplate'
import type { AppSnapshotPayload } from '../../src/types/appState'
import type { BoardFacts, DeskFact } from './boardFacts'

export const TEMPLATE_EDIT_KINDS = ['add-student', 'change-teacher', 'delete-desk'] as const
export type TemplateEditKind = (typeof TEMPLATE_EDIT_KINDS)[number]
export const TEMPLATE_EDIT_KIND_LABELS: Record<TemplateEditKind, string> = {
  'add-student': '生徒を 1 人足す', 'change-teacher': '講師を替える', 'delete-desk': '机を消す',
}

/** テンプレ作成の画面の机 1 つ。 */
export type TemplateEditorDesk = {
  /** template_{曜日(日曜 0)}_{時限}(テンプレ作成の画面のセル ID)。 */
  cellId: string
  dayOfWeek: number
  slotNumber: number
  /** 0 始まり(画面の机の並び・テンプレの deskIndex - 1)。 */
  deskIndex: number
  teacherId: string
  /** 講師の表示名(名簿に無い ID・空なら '')。画面の講師欄と同じ。 */
  teacher: string
  students: Array<{ studentId: string; subject: string } | null>
}

/** 盤面で、前の版のその机が当たっているコマ(cellId)と、その講師の机(deskKey)。 */
export type TemplateDeskAnchor = { cellId: string; dateKey: string; deskKey: string }

export type TemplateEditTarget =
  | { kind: TemplateEditKind; desk: TemplateEditorDesk; seat?: number; anchorCellIds: string[]; anchorDeskKeys: string[] }
  | { kind: TemplateEditKind; skip: string }

function asArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? (value as T[]) : []
}

/** dateKey(YYYY-MM-DD)の曜日(日曜 0)。テンプレの dayOfWeek と同じ数え方。 */
function dayOfWeekOf(dateKey: string): number {
  return new Date(`${dateKey}T00:00:00Z`).getUTCDay()
}

/** テンプレ作成の画面に出る机の一覧(定休日の曜日は配置できないので出さない)。テンプレが無ければ空。 */
export function buildTemplateEditorDesks(payload: AppSnapshotPayload, todayKey: string): TemplateEditorDesk[] {
  const settings = payload?.classroomSettings
  const template = settings?.regularLessonTemplate as RegularLessonTemplate | undefined
  if (!template) return []
  const teachers = asArray<TeacherRow>(payload.teachers)
  const students = asArray<StudentRow>(payload.students)
  const baseline = resolveTemplateDiffBaseline({ template, deskCount: settings.deskCount, teachers, students, todayKey })
  if (!baseline) return []
  const nameById = new Map(teachers.map((teacher) => [teacher.id, getTeacherDisplayName(teacher)]))
  const studentIds = new Set(students.map((student) => student.id))
  const closed = new Set(asArray<number>(settings.closedWeekdays))
  const result: TemplateEditorDesk[] = []
  for (const cell of baseline.cells) {
    if (closed.has(cell.dayOfWeek)) continue
    cell.desks.forEach((desk, deskIndex) => {
      result.push({
        cellId: `template_${cell.dayOfWeek}_${cell.slotNumber}`,
        dayOfWeek: cell.dayOfWeek,
        slotNumber: cell.slotNumber,
        deskIndex,
        teacherId: desk.teacherId ?? '',
        teacher: nameById.get(desk.teacherId) ?? '',
        // 画面は名簿にある生徒だけを出す(buildTemplateBoardCells)。
        students: [0, 1].map((seat) => {
          const student = desk.students[seat]
          return student?.studentId && studentIds.has(student.studentId) ? { studentId: student.studentId, subject: student.subject } : null
        }),
      })
    })
  }
  return result
}

/**
 * 盤面で、前の版のその机が当たっているコマ: 反映日以降・同じ曜日と時限で、その講師がテンプレ由来(teacherOrigin='template')で座っているコマ。
 * 休日・丸ごと振替の日・年度の外など、テンプレが当たらない日はここに入らない(テンプレの講師が居ないため)。
 */
export function findTemplateDeskAnchorCells(facts: BoardFacts, params: { dayOfWeek: number; slotNumber: number; fromDateKey: string; teacher: string }): TemplateDeskAnchor[] {
  if (!params.teacher) return []
  const anchors: TemplateDeskAnchor[] = []
  for (const desk of facts.desks.values()) {
    if (desk.dateKey < params.fromDateKey || desk.slotNumber !== params.slotNumber || dayOfWeekOf(desk.dateKey) !== params.dayOfWeek) continue
    if (desk.teacher !== params.teacher || desk.teacherOrigin !== 'template') continue
    anchors.push({ cellId: desk.cellId, dateKey: desk.dateKey, deskKey: desk.key })
  }
  return anchors.sort((left, right) => left.dateKey.localeCompare(right.dateKey) || left.deskKey.localeCompare(right.deskKey))
}

/** 盤面の机に手入力(手入力の生徒・出欠記録・メモ・保留の下段・講師の休み)が無いか。 */
function isCleanBoardDesk(desk: DeskFact | undefined): boolean {
  if (!desk) return false
  return desk.students.every((student) => student === null || student.origin === 'template')
    && desk.statuses.length === 0 && desk.memos.length === 0
    && desk.pendingStudents.length === 0 && desk.pendingTeacher === '' && desk.pendingStatuses.length === 0 && desk.pendingMemos.length === 0
    && !desk.teacherRest
}

function shuffled<T>(list: readonly T[], random: () => number): T[] {
  const result = [...list]
  for (let index = result.length - 1; index > 0; index -= 1) {
    const pick = Math.floor(random() * (index + 1))
    ;[result[index], result[pick]] = [result[pick], result[index]]
  }
  return result
}

/**
 * 変えるテンプレの机を 1 つ選ぶ。共通: 本物の講師がいる机で、盤面に確かめる日(findTemplateDeskAnchorCells)が 1 つ以上あり、
 * その日のその講師の机に手入力が無い。種類ごと: 生徒を足す＝空いた席がある(席も乱数で選ぶ)／講師を替える・机を消す＝生徒が 1 人以上いて、
 * その講師がテンプレのそのコマに 1 机だけ(替えた・消したあとにその講師がそのコマのテンプレに残らない)。excludeCellIds のコマ(前の変更で使った)は選ばない。
 */
export function pickTemplateEditTarget(params: {
  kind: TemplateEditKind
  desks: readonly TemplateEditorDesk[]
  facts: BoardFacts
  fromDateKey: string
  random: () => number
  excludeCellIds?: ReadonlySet<string>
}): TemplateEditTarget {
  const { kind, desks, facts, fromDateKey, random } = params
  const teacherCountByCell = new Map<string, number>()
  for (const desk of desks) {
    if (!desk.teacherId) continue
    const key = `${desk.cellId}\u0000${desk.teacherId}`
    teacherCountByCell.set(key, (teacherCountByCell.get(key) ?? 0) + 1)
  }
  const eligible = desks.filter((desk) => {
    if (params.excludeCellIds?.has(desk.cellId) || desk.teacher === '') return false
    if (kind === 'add-student') return desk.students.some((student) => student === null)
    return desk.students.some((student) => student !== null) && teacherCountByCell.get(`${desk.cellId}\u0000${desk.teacherId}`) === 1
  })
  for (const desk of shuffled(eligible, random)) {
    const anchors = findTemplateDeskAnchorCells(facts, { dayOfWeek: desk.dayOfWeek, slotNumber: desk.slotNumber, fromDateKey, teacher: desk.teacher })
    if (anchors.length === 0 || !anchors.every((anchor) => isCleanBoardDesk(facts.desks.get(anchor.deskKey)))) continue
    const base = { kind, desk, anchorCellIds: [...new Set(anchors.map((anchor) => anchor.cellId))], anchorDeskKeys: anchors.map((anchor) => anchor.deskKey) }
    if (kind !== 'add-student') return base
    const seats = [0, 1].filter((seat) => desk.students[seat] === null)
    return { ...base, seat: seats[Math.floor(random() * seats.length)] }
  }
  return { kind, skip: `候補の机がありません(本物の講師がいて、盤面の ${fromDateKey} 以降にその机が当たり、手入力の無い机${kind === 'add-student' ? '・空いた席' : '・生徒'}が要る)` }
}

/**
 * 画面のプルダウンの選択肢から 1 つ選ぶ(値が空のもの・exclude は選ばない)。prefer に合うものがあればその中から、無ければ残りから(requirePreferred なら null)。無ければ null。
 * 選択肢の並びは画面の並び(アプリが並べる)のまま使う(同じデータ・同じ種なら同じ結果)。
 */
export function pickTemplateEditOption(params: { options: ReadonlyArray<{ value: string; label?: string }>; exclude: ReadonlySet<string>; prefer: (value: string) => boolean; random: () => number; requirePreferred?: boolean }): string | null {
  const eligible = params.options.map((option) => option.value).filter((value) => value !== '' && !params.exclude.has(value))
  const preferred = eligible.filter((value) => params.prefer(value))
  // requirePreferred: 望ましいものが無ければ選ばない(講師を替える＝確かめる日のコマに既に居る講師へ替えると、点検の「新しい講師が居る」が素通りするため)。
  const pool = preferred.length > 0 ? preferred : (params.requirePreferred ? [] : eligible)
  if (pool.length === 0) return null
  return pool[Math.floor(params.random() * pool.length)]
}

/** コマ(cellId の一覧)に居る生徒(上段・保留の下段・出欠記録)のキーと、講師(講師欄・保留の下段・講師の休み)の名前。 */
export function collectCellPresence(facts: BoardFacts, cellIds: readonly string[]): { studentKeys: Set<string>; teachers: Set<string> } {
  const cells = new Set(cellIds)
  const studentKeys = new Set<string>()
  const teachers = new Set<string>()
  for (const desk of facts.desks.values()) {
    if (!cells.has(desk.cellId)) continue
    for (const student of [...desk.students, ...desk.pendingStudents]) if (student) studentKeys.add(student.key)
    for (const status of [...desk.statuses, ...desk.pendingStatuses]) studentKeys.add(status.split('|')[0])
    for (const name of [desk.teacher, desk.pendingTeacher, desk.teacherRestName]) if (name) teachers.add(name)
  }
  return { studentKeys, teachers }
}

/** 講師の表示名(画面の講師のプルダウンの値)から講師 ID。名簿に無ければ ''。 */
export function resolveTeacherIdByDisplayName(teachers: readonly TeacherRow[] | undefined, name: string): string {
  return asArray<TeacherRow>(teachers).find((teacher) => getTeacherDisplayName(teacher) === name)?.id ?? ''
}
