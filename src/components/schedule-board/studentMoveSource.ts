import type { DeskCell, SlotCell, StudentEntry } from './types'

/**
 * 移動元として選んだ席（セル＋机＋席）。メニューの「移動」・長押し D&D・日程表 D&D で、どの授業を動かすかを席で決める。
 *
 * 授業の id はテンプレの授業で `生徒ID_日付_科目`（createManagedStudentEntry）と時限を含まないので、同じ日に同じ科目を
 * 2 コマ持つ生徒は 2 つの授業が同じ id になる。id だけで移動元を探すと、後ろの時限を選んでも前の時限の授業が動いていた
 * （2026-11-07・INV-02 / INV-11）。id の形は在庫・履歴・保存データ・再マージの突き合わせが使うので変えず、移動元を席で決める。
 */
export type StudentMoveSourceSeat = { cellId: string; deskIndex: number; studentIndex: number }

export type StudentMoveSourceHit = { cell: SlotCell; desk: DeskCell; deskIndex: number; studentIndex: number; student: StudentEntry }

/** セルの並び（机→席）で最初に id が一致した授業。 */
function findFirstByIdInCells(cells: readonly SlotCell[], movingStudentId: string): StudentMoveSourceHit | null {
  for (const cell of cells) {
    for (let deskIndex = 0; deskIndex < cell.desks.length; deskIndex++) {
      const desk = cell.desks[deskIndex]
      if (!desk.lesson) continue
      const studentIndex = desk.lesson.studentSlots.findIndex((student) => student?.id === movingStudentId)
      if (studentIndex < 0) continue
      const student = desk.lesson.studentSlots[studentIndex]
      if (!student) continue
      return { cell, desk, deskIndex, studentIndex, student }
    }
  }
  return null
}

/**
 * 移動元の授業を決める**唯一の権威関数**（computeStudentMove・着地の確認・保留の机の判定・休日の入れ替え検査・移動中の表示が通す）。
 * 1. 選んだ席が渡り、その席の生徒の id が movingStudentId と同じなら、その席。
 * 2. 席が古い（机の並べ替え・再マージ・QR 反映で席の中身が変わった）ときは、**選んだコマ（cellId＝日付×時限で一意）の中**で id が一致した授業
 *    （全体の先頭へ落とすと、2 限を選んだのに同じ id の 1 限を動かす・regression-reviewer S-1）。
 * 3. 席が渡らない・選んだコマにその id が無いときは従来どおり、セルの並び順で最初に id が一致した授業。
 * 返す cell / desk / student は渡したセルの参照そのもの（computeStudentMove は複製した weeks を渡して、その場で書き換える）。
 */
export function findStudentMoveSource(cells: readonly SlotCell[], movingStudentId: string, sourceSeat?: StudentMoveSourceSeat | null): StudentMoveSourceHit | null {
  if (sourceSeat) {
    const cell = cells.find((candidate) => candidate.id === sourceSeat.cellId)
    const desk = cell?.desks[sourceSeat.deskIndex]
    const student = desk?.lesson?.studentSlots[sourceSeat.studentIndex] ?? null
    if (cell && desk && student && student.id === movingStudentId) {
      return { cell, desk, deskIndex: sourceSeat.deskIndex, studentIndex: sourceSeat.studentIndex, student }
    }
    const inSelectedCell = cell ? findFirstByIdInCells([cell], movingStudentId) : null
    if (inSelectedCell) return inSelectedCell
  }
  return findFirstByIdInCells(cells, movingStudentId)
}

/**
 * 盤面の選択枠（移動中の生徒）を付ける席か。selectedSeat（動かす授業の席＝findStudentMoveSource の結果）があればその席だけ、
 * 無ければ従来どおり id が同じ席すべて。同じ id の授業が 2 つあっても、動かす方にだけ枠が付く。
 */
export function isBoardStudentSeatSelected(params: {
  selectedStudentId: string | null
  selectedSeat?: StudentMoveSourceSeat | null
  student: StudentEntry | null | undefined
  cellId: string
  deskIndex: number
  studentIndex: number
}): boolean {
  const { selectedStudentId, selectedSeat, student } = params
  if (selectedStudentId === null || !student || student.id !== selectedStudentId) return false
  if (!selectedSeat) return true
  return selectedSeat.cellId === params.cellId && selectedSeat.deskIndex === params.deskIndex && selectedSeat.studentIndex === params.studentIndex
}
