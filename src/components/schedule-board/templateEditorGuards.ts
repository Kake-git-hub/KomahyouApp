// テンプレ編集(通常授業テンプレ作成)の配置検査(INV-12 配置の一意性・2026-10-14)。
//
// 背景: 確認リスト 2026-10-14 の質問「テンプレの講師が追従していない日がある」を実データで追ったところ、
// 開発用教室のテンプレで**同じコマ(曜日×時限)に同じ生徒が 2 机に入っていた**(金 3 限の机 4 と机 7)。盤面を組む
// buildManagedRegularLessonsRange は同じコマに既にいる生徒の行を講師ごと飛ばすため、机 7 の講師が消え、次の行(机 8 の
// 講師だけ)が「先頭の空き机」の机 7 に置かれて、11/6 以降の金 3 限で講師がテンプレと食い違っていた。
// テンプレ編集の「移動」(handleTemplateMoveStudent)は Issue #56 で同コマ重複の検査が配線済みだったが、
// 「生徒追加」(handleTemplateConfirmAdd)と「生徒変更」(handleTemplateConfirmEdit)には検査が無かった(INV-12 の穴)。
//
// 1 席ぶんの検査(追加・変更)は、移動と同じ権威関数 `findDuplicateStudentInCellByKey`(ScheduleBoardScreen.tsx・Issue #56)を
// そのまま使う(regression-reviewer 指摘: 写しを作ると 6793374 型のずれの温床になる)。ここは保存前の**テンプレ全体**の検査だけ。
// 純関数だけ(テストで固定: inv12-placement-uniqueness.matrix.test.ts)。生徒の同一性は盤面と同じ
// 比較キー(resolveStockComparableStudentKey ＝ managedStudentId 優先)を呼び出し側から受け取る。

import type { SlotCell, StudentEntry } from './types'

export type TemplateDuplicateStudent = {
  cell: SlotCell
  /** 同じキーで同じコマに生きている生徒(2 人以上・机の順)。 */
  students: StudentEntry[]
  /** それぞれの生徒が居る机の番号(1 始まり・students と同じ順)。文言で「机 4・机 7」と示す用。 */
  deskNumbers: number[]
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
    const byKey = new Map<string, Array<{ student: StudentEntry; deskNumber: number }>>()
    cell.desks.forEach((desk, deskIndex) => {
      for (const student of desk.lesson?.studentSlots ?? []) {
        if (!student) continue
        const key = resolveComparableKey(student)
        if (!key) continue
        const list = byKey.get(key) ?? []
        list.push({ student, deskNumber: deskIndex + 1 })
        byKey.set(key, list)
      }
    })
    for (const entries of byKey.values()) {
      if (entries.length >= 2) result.push({ cell, students: entries.map((entry) => entry.student), deskNumbers: entries.map((entry) => entry.deskNumber) })
    }
  }
  return result
}

/**
 * 止めるときの文言。「金曜 3限: ○○(机 4・机 7)」の形でコマ・生徒・机を並べる(表示名は呼び出し側が解決)。
 * action は何を止めたか(保存／Excel の取り込み)。取り込みは「Excel を直して」と添える。
 */
export function buildTemplateDuplicateStudentsMessage(
  duplicates: readonly TemplateDuplicateStudent[],
  resolveDisplayName: (name: string) => string,
  resolveCellLabel: (cell: SlotCell) => string,
  action: 'save' | 'import' = 'save',
): string {
  const parts = duplicates.map((entry) => `${resolveCellLabel(entry.cell)}: ${resolveDisplayName(entry.students[0].name)}(${entry.deskNumbers.map((number) => `机 ${number}`).join('・')})`)
  if (action === 'import') {
    return `Excel を取り込めません。同じコマに同じ生徒が 2 か所に入っています(${parts.join(' / ')})。Excel で片方の席から外してから取り込み直してください。`
  }
  return `同じコマに同じ生徒が 2 か所に入っているため保存できません(${parts.join(' / ')})。どちらかの席から外してください。`
}
