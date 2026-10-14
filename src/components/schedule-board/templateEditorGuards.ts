// テンプレ編集(通常授業テンプレ作成)の配置検査(INV-12 配置の一意性・2026-10-14)。
//
// 背景: 確認リスト 2026-10-14 の質問「テンプレの講師が追従していない日がある」を実データで追ったところ、
// 開発用教室のテンプレで**同じコマ(曜日×時限)に同じ生徒が 2 机に入っていた**(金 3 限の机 4 と机 7)。盤面を組む
// buildManagedRegularLessonsRange は同じコマに既にいる生徒の行を講師ごと飛ばすため、机 7 の講師が消え、次の行(机 8 の
// 講師だけ)が「先頭の空き机」の机 7 に置かれて、11/6 以降の金 3 限で講師がテンプレと食い違っていた。
// テンプレ編集の「移動」(handleTemplateMoveStudent)は Issue #56 で同コマ重複の検査が配線済みだったが、
// 「生徒追加」(handleTemplateConfirmAdd)と「生徒変更」(handleTemplateConfirmEdit)には検査が無かった(INV-12 の穴)。
//
// ここは純関数だけ(テストで固定: inv12-placement-uniqueness.matrix.test.ts)。生徒の同一性は盤面と同じ
// 比較キー(resolveStockComparableStudentKey ＝ managedStudentId 優先)を呼び出し側から受け取る。

import type { SlotCell, StudentEntry } from './types'

export type TemplateDuplicateStudent = {
  cell: SlotCell
  /** 同じキーで同じコマに生きている生徒(2 人以上・机の順)。 */
  students: StudentEntry[]
}

/**
 * 同じコマに、候補と同じ生徒(比較キーが同じ)が既にいればそのエントリを返す(無ければ null)。
 * excludedEntryIds は「自分自身」(変更中の席の生徒)を除く用。
 */
export function findTemplateSeatDuplicate(
  cell: SlotCell,
  candidateKey: string,
  resolveComparableKey: (student: StudentEntry) => string,
  excludedEntryIds: ReadonlyArray<string | undefined> = [],
): StudentEntry | null {
  const excluded = new Set(excludedEntryIds.filter((id): id is string => Boolean(id)))
  for (const desk of cell.desks) {
    for (const student of desk.lesson?.studentSlots ?? []) {
      if (!student || excluded.has(student.id)) continue
      if (resolveComparableKey(student) === candidateKey) return student
    }
  }
  return null
}

/**
 * テンプレ全体で、同じコマに同じ生徒が 2 か所以上いるコマを列挙する(保存前の検査・過去に作られた重複の救済)。
 * 空のキーは比べない(名前も ID も無い生徒は無い前提だが、万一あっても止めない)。
 */
export function findTemplateDuplicateStudents(
  cells: readonly SlotCell[],
  resolveComparableKey: (student: StudentEntry) => string,
): TemplateDuplicateStudent[] {
  const result: TemplateDuplicateStudent[] = []
  for (const cell of cells) {
    const byKey = new Map<string, StudentEntry[]>()
    for (const desk of cell.desks) {
      for (const student of desk.lesson?.studentSlots ?? []) {
        if (!student) continue
        const key = resolveComparableKey(student)
        if (!key) continue
        const list = byKey.get(key) ?? []
        list.push(student)
        byKey.set(key, list)
      }
    }
    for (const students of byKey.values()) {
      if (students.length >= 2) result.push({ cell, students })
    }
  }
  return result
}

/** 保存を止めるときの文言。「金曜 3限: ○○」の形でコマと生徒を並べる(表示名は呼び出し側が解決)。 */
export function buildTemplateDuplicateStudentsMessage(
  duplicates: readonly TemplateDuplicateStudent[],
  resolveDisplayName: (name: string) => string,
  resolveCellLabel: (cell: SlotCell) => string,
): string {
  const parts = duplicates.map((entry) => `${resolveCellLabel(entry.cell)}: ${resolveDisplayName(entry.students[0].name)}`)
  return `同じコマに同じ生徒が 2 か所に入っているため保存できません(${parts.join(' / ')})。どちらかの席から外してください。`
}
