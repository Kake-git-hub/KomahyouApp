// 同日移動の写し（旧テンプレの通常授業を日の中で手で動かしたもの）への注意表示（A-12・オーナー決定 2026-11-01・spec-template-behavior §H Q36）。
//
// テンプレ保存（templateDiffApply の Q36 検出 → 入口 applySameDayMoveCopyNotices）が写しに印 `templateCopyNotice` を付ける。
//  - superseded＝新テンプレが同じ日の別のコマにも同じ生徒×科目の通常授業を置く → 同じ日に 2 か所。盤面は写しの席を緑にして
//    「同じ日の別のコマ（n限）にも…」と知らせる。別のコマの授業がその後の操作で消えていれば（室長が片づけた）出さない＝描画時に盤面から確かめる。
//  - stale＝テンプレではこの日にこの授業が無い → 緑＋「テンプレではこの日のこの授業は無くなりました」。
// 印は表示専用（INV-13）: 日程表・PDF（stripTemplatePendingLowerForPdf が外す）・回数・在庫には効かない。
// 純関数だけ（描画は BoardGrid）。
import { isSameDayMovedTemplateCopy, studentSubjectKey } from './templateDiffApply'
import type { SlotCell, StudentEntry } from './types'

/** 盤面の席に付けるクラス（緑・CSS は App.css）。PDF はこのクラスと注意の帯を外す。 */
export const SAME_DAY_MOVE_COPY_NOTICE_CLASS = 'sa-student-copy-notice'
/** 名前の行に出す短い注意の帯のクラス。 */
export const SAME_DAY_MOVE_COPY_NOTE_CLASS = 'sa-student-copy-note'

export type SameDayMoveCopyNoticeView = {
  kind: 'superseded' | 'stale'
  /** superseded: 同じ日に同じ授業が生きている別のコマの時限（昇順）。stale: 空。 */
  otherSlotNumbers: number[]
  /** 席に出す短い帯。 */
  badge: string
  /** ツールチップの注意文。 */
  title: string
}

export type SameDayRegularSlotIndex = ReadonlyMap<string, ReadonlyArray<{ cellId: string; slotNumber: number }>>

/** その週の各セルの上段に生きている通常授業を `${日付}::${生徒×科目}` → コマの一覧で引く索引（描画のたびに 1 回作る）。 */
export function buildSameDayRegularSlotIndex(cells: readonly SlotCell[]): SameDayRegularSlotIndex {
  const index = new Map<string, Array<{ cellId: string; slotNumber: number }>>()
  for (const cell of cells) {
    for (const desk of cell.desks) {
      for (const student of desk.lesson?.studentSlots ?? []) {
        if (!student || student.lessonType !== 'regular') continue
        const key = `${cell.dateKey}::${studentSubjectKey(student)}`
        const list = index.get(key) ?? []
        list.push({ cellId: cell.id, slotNumber: cell.slotNumber })
        index.set(key, list)
      }
    }
  }
  return index
}

export function describeSameDayMoveCopyNotice(kind: SameDayMoveCopyNoticeView['kind'], otherSlotNumbers: readonly number[]): string {
  if (kind === 'superseded') {
    return `同じ日の別のコマ（${otherSlotNumbers.join('・')}限）にもこの生徒の同じ授業がテンプレで組まれています。どちらかを片づけてください。`
  }
  return 'テンプレではこの日のこの授業は無くなりました。残すか消すかを決めてください。'
}

/**
 * 席に出す注意（無ければ null）。
 *  - 印が無い／写しでない（別の日へ動かして振替になった等）→ null。
 *  - superseded: 同じ日の別のコマに同じ生徒×科目の通常授業が**今**生きているときだけ出す（片づけ済みなら出さない）。
 *  - stale: 印のまま出す（次のテンプレ保存で付け直される）。
 */
export function resolveSameDayMoveCopyNotice(
  student: StudentEntry,
  cell: Pick<SlotCell, 'id' | 'dateKey'>,
  index: SameDayRegularSlotIndex,
): SameDayMoveCopyNoticeView | null {
  const kind = student.templateCopyNotice
  if (!kind || !isSameDayMovedTemplateCopy(student, cell.dateKey)) return null
  if (kind === 'superseded') {
    const others = (index.get(`${cell.dateKey}::${studentSubjectKey(student)}`) ?? []).filter((item) => item.cellId !== cell.id).map((item) => item.slotNumber)
    const otherSlotNumbers = [...new Set(others)].sort((a, b) => a - b)
    if (otherSlotNumbers.length === 0) return null
    return { kind, otherSlotNumbers, badge: `※${otherSlotNumbers.join('・')}限にも`, title: describeSameDayMoveCopyNotice(kind, otherSlotNumbers) }
  }
  return { kind, otherSlotNumbers: [], badge: '※テンプレに無し', title: describeSameDayMoveCopyNotice(kind, []) }
}
