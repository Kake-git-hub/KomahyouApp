// 同日移動の写し（旧テンプレの通常授業を日の中で手で動かしたもの）への注意表示（A-12・オーナー決定 2026-11-01・spec-template-behavior §H Q36）。
//
// ★オーナー決定 2026-11-05（確認リスト tp-71・tp-72・決定記録 63）で A-12 は撤回した。写しはテンプレ保存の Q36 でテンプレの位置へ戻すので、
//   注意の印 `templateCopyNotice` はもう付けない。2026-11-01〜11-04 の保存で付いた印が盤面データに残っていても、描画では無視する
//   （resolveSameDayMoveCopyNotice は常に null）。緑と帯は出ない。印のフィールドは旧データの読み込みのため型に残す（保存データは JSON のまま）。
//   ★「印から緑と帯を出す」描画へ戻さない（回帰防止・sameDayMoveCopyNotice.test.ts が検出する）。
//
// 旧仕様（記録）: テンプレ保存が写しに印を付け、superseded は同じ日の別のコマにも生きているときだけ緑＋「※n限にも」、stale は緑＋「※テンプレに無し」。
// 印は表示専用（INV-13）: 日程表・PDF（stripTemplatePendingLowerForPdf が外す）・回数・在庫には効かない。
import { studentSubjectKey } from './templateDiffApply'
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
 * 席に出す注意。オーナー決定 2026-11-05（決定記録 63）で A-12 を撤回したので**常に null**（旧データに印が残っていても出さない）。
 * 引数は描画側（BoardGrid）の呼び出しを変えないために残す。
 */
export function resolveSameDayMoveCopyNotice(
  student: StudentEntry,
  cell: Pick<SlotCell, 'id' | 'dateKey'>,
  index: SameDayRegularSlotIndex,
): SameDayMoveCopyNoticeView | null {
  void student
  void cell
  void index
  return null
}
