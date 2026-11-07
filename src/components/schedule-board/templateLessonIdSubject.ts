// 授業 ID（ScheduleBoardScreen の createManagedStudentEntry が作る `生徒ID_日付_科目`）からテンプレの科目を読む純関数（型以外の依存なし）。
// 2026-11-07: templateDiffApply.ts から移した（wholeDayTransferPair.ts → templateDiffApply.ts → templateConflictRules.ts → makeupStock.ts → wholeDayTransferPair.ts の
// 循環参照を解消・挙動不変）。templateDiffApply.ts からも再輸出している。
import type { StudentEntry } from './types'

/**
 * テンプレの通常授業の「テンプレ上の科目」を授業 ID から読む（ScheduleBoardScreen の createManagedStudentEntry が作る `生徒ID_日付_科目`）。
 * 「編集」で科目だけ変えた通常授業（通常 → 通常）は subject が変わっても ID はテンプレのまま残るので、印の無い既存の保存データでも元の科目が読める。
 * 手動追加・ID がテンプレの形でない・ID の日付が違う（その日のテンプレの授業でない）ときは null。
 * 抑止キーの権威関数 resolveSuppressedRegularLessonOccurrenceKeys（ScheduleBoardScreen）と写しのキー外し（templateDiffApply.ts の resolveSameDayMoveCopyKeysToRemove）が共有する（2026-11-07・INV-12）。
 */
export function resolveTemplateLessonSubjectFromId(student: Pick<StudentEntry, 'id' | 'managedStudentId' | 'lessonType' | 'manualAdded'>, dateKey: string): string | null {
  if (student.lessonType !== 'regular') return null
  return readTemplateLessonSubjectFromLessonId(student, dateKey)
}

/**
 * 別の日へ動かしたテンプレの授業（振替・振替元つき）の、振替元の日のテンプレの科目を授業 ID から読む（移動は授業 ID を変えない）。
 * 「編集」で科目を変えた（数→国）テンプレの授業を別の日へ動かした振替は、科目（国）では振替元の日のテンプレ（数）と突き合わせられない。
 * テンプレ保存の「根拠を失った振替」（templateTransferFollow.ts の collectOrphanedMakeups）が、根拠をこの科目でも引くために使う（2026-11-07・INV-12 / INV-02 / INV-03）。
 * 振替でない・振替元の日が無い・手動追加・ID がテンプレの形でないときは null。
 */
export function resolveMovedTemplateLessonSubjectFromId(student: Pick<StudentEntry, 'id' | 'managedStudentId' | 'lessonType' | 'manualAdded' | 'makeupSourceDate'>): string | null {
  if (student.lessonType !== 'makeup' || !student.makeupSourceDate) return null
  return readTemplateLessonSubjectFromLessonId(student, student.makeupSourceDate)
}

function readTemplateLessonSubjectFromLessonId(student: Pick<StudentEntry, 'id' | 'managedStudentId' | 'manualAdded'>, dateKey: string): string | null {
  if (student.manualAdded || !student.managedStudentId || !student.id) return null
  const prefix = `${student.managedStudentId}_${dateKey}_`
  if (!student.id.startsWith(prefix)) return null
  const subject = student.id.slice(prefix.length)
  return subject && !subject.includes('_') ? subject : null
}

/** 抑止キーに使う科目の並び: [今の科目, 授業 ID のテンプレの科目（違うときだけ）]。 */
export function resolveTemplateLessonSubjectVariants(student: Pick<StudentEntry, 'id' | 'managedStudentId' | 'lessonType' | 'manualAdded' | 'subject'>, dateKey: string): string[] {
  const templateSubject = resolveTemplateLessonSubjectFromId(student, dateKey)
  return templateSubject && templateSubject !== student.subject ? [student.subject, templateSubject] : [student.subject]
}
