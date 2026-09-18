// 保護者からの休み連絡(docs/spec-parent-portal.md §0-5)を盤面のどの席へ当てるかを決める純関数。
// 盤面モーダルの四択(休み/振無休/振替先を今決める)はここで見つけた席に対して既存の出欠処理を呼ぶだけで、
// 会計(在庫・台帳)のロジックはここに持たない(INV-06 の権威は ScheduleBoardScreen の出欠ハンドラ)。
import type { StudentRow } from '../basic-data/basicDataModel'
import { getStudentDisplayName } from '../basic-data/basicDataModel'
import type { LessonType, SlotCell, StudentEntry } from './types'

export type ParentAbsenceAction = 'absent' | 'absent-no-makeup' | 'makeup-now'

// App → 盤面の一過性コマンド。Issue #46 と同型の再発火を防ぐため、盤面は処理したら必ず App 側の state を
// 消費(null)させる(shouldProcessParentAbsenceRequest / consumeParentAbsenceRequest)。
export type ParentAbsenceRequest = {
  requestId: number
  messageId: string
  studentId: string
  dateKey: string
  slotNumber: number
  subject: string
  action: ParentAbsenceAction
}

export type ParentAbsenceRequestResult = {
  requestId: number
  messageId: string
  action: ParentAbsenceAction
  ok: boolean
  // ok=false のとき室長へ見せる理由(盤面にコマが無い等)。ok=true のときは空文字。
  message: string
}

export type ParentAbsenceTarget = { cellId: string; deskIndex: number; studentIndex: number }

export type ParentAbsenceTargetResolution =
  | { ok: true; target: ParentAbsenceTarget; student: StudentEntry }
  | { ok: false; reason: 'cell-not-found' | 'student-not-found' }

// 保護者ページに出るのは通常・振替・増コマだけ(講習 special と体験 trial は出さない)。盤面側も同じ集合に限る。
const PARENT_ABSENCE_LESSON_TYPES: ReadonlySet<LessonType> = new Set(['regular', 'makeup', 'extra'])

function normalizeName(value: string | null | undefined): string {
  return (value ?? '').replace(/\s+/g, '')
}

// 名簿の name / 表示名(空白除去)→ 所有者 id。同じ名前を 2 人以上が持つ場合は '' (=名前では決められない)。
// scheduleViewData.buildUniqueStudentNameOwnerMap / parentSchedule.ts と同じ決め方(同名別人の混同防止)。
function buildUniqueNameOwnerMap(students: readonly StudentRow[]): Map<string, string> {
  const ownerByName = new Map<string, string>()
  for (const student of students) {
    for (const rawName of [student.name, getStudentDisplayName(student)]) {
      const key = normalizeName(rawName)
      if (!key) continue
      const current = ownerByName.get(key)
      if (current !== undefined && current !== student.id) ownerByName.set(key, '')
      else if (current !== '') ownerByName.set(key, student.id)
    }
  }
  return ownerByName
}

// 盤面の生徒が名簿の studentId 本人か。managedStudentId があればそれだけで決め(名前一致で拾わない)、
// 無いときだけ「名簿で一意な名前」の一致で拾う。
export function isBoardStudentOwnedBy(entry: Pick<StudentEntry, 'managedStudentId' | 'name'>, studentId: string, ownerByName: ReadonlyMap<string, string>): boolean {
  if (!studentId) return false
  if (entry.managedStudentId) return entry.managedStudentId === studentId
  const key = normalizeName(entry.name)
  return key !== '' && ownerByName.get(key) === studentId
}

/**
 * 休み連絡の対象席を 1 週間分のセルから探す。
 * - 日付・時限が一致するセルの中で、本人の通常/振替/増コマを探す。
 * - 同じコマに本人が複数居る(通常ありえないが手動追加で起こりうる)ときは、連絡の科目に一致する席を優先する。
 * - 見つからない = すでに休みにした・別の日へ動かした・削除した、のいずれか。呼び出し側は何も変えず室長へ知らせる。
 */
export function resolveParentAbsenceTarget(params: {
  cells: readonly SlotCell[]
  students: readonly StudentRow[]
  studentId: string
  dateKey: string
  slotNumber: number
  subject: string
}): ParentAbsenceTargetResolution {
  const cell = params.cells.find((candidate) => candidate.dateKey === params.dateKey && candidate.slotNumber === params.slotNumber)
  if (!cell) return { ok: false, reason: 'cell-not-found' }

  const ownerByName = buildUniqueNameOwnerMap(params.students)
  const matches: Array<{ target: ParentAbsenceTarget; student: StudentEntry }> = []
  cell.desks.forEach((desk, deskIndex) => {
    desk.lesson?.studentSlots.forEach((student, studentIndex) => {
      if (!student) return
      if (!PARENT_ABSENCE_LESSON_TYPES.has(student.lessonType)) return
      if (!isBoardStudentOwnedBy(student, params.studentId, ownerByName)) return
      matches.push({ target: { cellId: cell.id, deskIndex, studentIndex }, student })
    })
  })
  if (matches.length === 0) return { ok: false, reason: 'student-not-found' }
  const bySubject = matches.find((match) => match.student.subject === params.subject)
  const picked = bySubject ?? matches[0]
  return { ok: true, target: picked.target, student: picked.student }
}

export const PARENT_ABSENCE_TARGET_NOT_FOUND_MESSAGE = '盤面にこのコマが見つかりません(すでに休み・移動・削除の処理が済んでいる可能性があります)。盤面を確認して「何もしない」で閉じてください。'

// --- 一過性コマンドの消費判定(teacherAutoAssignRequest と同じ 2 点で守る) ---
export function shouldProcessParentAbsenceRequest(request: ParentAbsenceRequest | null | undefined, processedRequestId: number | null): boolean {
  if (!request) return false
  return processedRequestId !== request.requestId
}

// 処理した requestId と現在の state の requestId が一致するときだけ null 化する(より新しいリクエストは消さない)。
export function consumeParentAbsenceRequest(current: ParentAbsenceRequest | null, processedRequestId: number): ParentAbsenceRequest | null {
  if (current && current.requestId === processedRequestId) return null
  return current
}
