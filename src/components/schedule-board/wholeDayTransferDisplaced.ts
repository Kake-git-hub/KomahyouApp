// 丸ごと振替の振替先に室長が置いていた授業（体験・増コマ・手動追加）を消さずに残す純関数
// （決定記録 48・2026-10-25・docs/plan-2026-10-25-conflict-placement.md §2 場面 1・§4 (a)・spec-template-behavior §H Q42）。
//
// ★原則（INV-02・決定記録 47）: 自動処理が授業を本来の机に置けないとき、消さない・隠さない・勝手に別の場所へ逃がさない。
//   移送後のコマの空き席へずらし（講師が居る机 → 講師の居ない机・机番号順・Q40-2 と同じ）、空き席が無ければ
//   **同じ机番号の机の下段（保留・緑・templatePendingDesks）**に残す（下段の 2 席が埋まっていれば次の机の下段）。
//   室長が動かすか採用で片づける。上段の席が空けば Q28 で自動で 1 行に戻る。
// ★対象は「室長の手置き」＝体験（trial）・増コマ（extra）・手動追加の通常（regular かつ manualAdded）。
//   テンプレ由来の通常授業（管理授業・同日移動の写しを含む manualAdded でない regular）は従来どおり消して希望回数 −1、
//   振替・講習は従来どおり未消化へ戻す（disposeDayDeskEntries＝全コマ削除と同一裁定・INV-06）。
// ★在庫中立: 体験・増コマ・手動追加は在庫も希望回数も持たない（appendDeletedStudentScheduleCountAdjustment が manualAdded を飛ばす）ので、
//   残しても消しても台帳は動かない。残す分は −1 の対象から外れる（消していないので当然）。
// ★フラグ: 保留は templateDiffApply の教室だけに存在する。呼び出し側はフラグ OFF なら保留マップを渡さない（＝従来どおり消して −1）。
// このファイルは純データ・純関数のみ（DOM / ネットワークに触らない）。

import type { DeskCell, DeskLesson, SlotCell, StudentEntry } from './types'
import { buildTemplatePendingDeskKey, placeIntoPendingLower, templatePendingStudentIdentity, type TemplatePendingDeskMap } from './templatePendingDesks'

/** 振替先から押し出される授業（移送前のコマ・机・席）。 */
export type WholeDayTransferDisplacedStudent = {
  cellId: string
  slotNumber: number
  deskIndex: number
  seatIndex: number
  student: StudentEntry
}

export type WholeDayTransferDisplacedOutcome = {
  student: StudentEntry
  /** 元の机番号（0 始まり）。 */
  deskIndex: number
  /** 置いた机番号（0 始まり）。下段に残したときは下段の机。 */
  placedDeskIndex: number
  placement: 'kept' | 'shifted' | 'pending'
  /** 置いた机に講師が居ない（講師が付くまで講師日程表に出ない＝Q40-2 と同じ扱い）。 */
  teacherless: boolean
}

/** 室長の手置きとして残す授業か（テンプレ由来の通常・振替・講習は false＝従来どおり処分）。 */
export function isWholeDayTransferDisplacedLesson(student: Pick<StudentEntry, 'lessonType' | 'manualAdded'>): boolean {
  if (student.lessonType === 'trial' || student.lessonType === 'extra') return true
  return student.lessonType === 'regular' && Boolean(student.manualAdded)
}

/**
 * 振替先のコマから残す授業を**取り出して机から外す**（机を直接書き換える）。残りは呼び出し側が従来どおり処分する。
 * 出欠記録（statusSlots）は丸ごと振替の事前ブロックで振替先に無いので見ない。
 */
export function extractWholeDayTransferDisplacedStudents(cell: SlotCell): WholeDayTransferDisplacedStudent[] {
  const displaced: WholeDayTransferDisplacedStudent[] = []
  cell.desks.forEach((desk, deskIndex) => {
    const lesson = desk.lesson
    if (!lesson) return
    lesson.studentSlots.forEach((student, seatIndex) => {
      if (!student || !isWholeDayTransferDisplacedLesson(student)) return
      displaced.push({ cellId: cell.id, slotNumber: cell.slotNumber, deskIndex, seatIndex, student: { ...student } })
      lesson.studentSlots[seatIndex] = null
    })
  })
  return displaced
}

function isSeatFree(desk: DeskCell, seatIndex: number) {
  return !desk.lesson?.studentSlots[seatIndex] && !desk.statusSlots?.[seatIndex]
}

function pickFreeSeat(desk: DeskCell, preferredSeat: number): number {
  if (isSeatFree(desk, preferredSeat)) return preferredSeat
  const other = preferredSeat === 0 ? 1 : 0
  return isSeatFree(desk, other) ? other : -1
}


/** 下段の理由文（ツールチップ・確認の画面）。 */
export function buildWholeDayTransferDisplacedNote(sourceDateKey: string, targetDateKey: string) {
  return `丸ごと振替（${sourceDateKey} → ${targetDateKey}）で振替先に置いていた授業に空き席が無かったため、保留（下段）に残しました。室長が動かすか採用で片づけてください。`
}

/**
 * 移送後のコマ（cell は移送済み・机を直接書き換える）に、押し出された授業を置き直す。
 *  1. 元の机に空き席があればそのまま残す（kept）。
 *  2. 無ければ同じコマの空き席へずらす（講師が居る机 → 講師の居ない机・机番号順・保留の机は使わない）（shifted）。
 *  3. 空き席が無ければ同じ机番号の机の下段へ（2 席とも埋まっていれば次の机の下段。最後の机まで埋まっていれば先頭から）（pending）。
 * 戻り値の nextPendingDesks は変化が無ければ入力と同じ参照。overflow は下段にも入らなかった授業（呼び出し側が従来どおり処分）。
 */
export function placeWholeDayTransferDisplacedStudents(params: {
  cell: SlotCell
  displaced: readonly WholeDayTransferDisplacedStudent[]
  pendingDesks: TemplatePendingDeskMap
  sourceDateKey: string
  targetDateKey: string
  createdAt: string
}): { outcomes: WholeDayTransferDisplacedOutcome[]; nextPendingDesks: TemplatePendingDeskMap; overflow: WholeDayTransferDisplacedStudent[] } {
  const { cell } = params
  const outcomes: WholeDayTransferDisplacedOutcome[] = []
  const overflow: WholeDayTransferDisplacedStudent[] = []
  let nextPendingDesks = params.pendingDesks
  const isPendingDesk = (desk: DeskCell) => Boolean(nextPendingDesks[buildTemplatePendingDeskKey(cell.id, desk.id)])

  const placeIntoDesk = (desk: DeskCell, seatIndex: number, student: StudentEntry, deskIndex: number) => {
    const lesson: DeskLesson = desk.lesson
      ? desk.lesson
      : { id: `daymove_kept_${cell.dateKey}_${cell.slotNumber}_${deskIndex}`, studentSlots: [null, null] }
    lesson.studentSlots[seatIndex] = student
    desk.lesson = lesson
  }

  for (const item of params.displaced) {
    const ownDesk = cell.desks[item.deskIndex]
    // INV-12（regression-reviewer H-2・2026-10-25）: 移送で同じ生徒が上段に居る（振替元の授業が移ってきた）なら、上段に残さず・ずらさず下段へ回す
    // （Q40-2 の 'duplicate' の兄弟。下段は配置でないので同じ生徒が上下に並ぶのは INV-12 違反ではなく、Q28 の合流も重複を止める）。
    const identity = templatePendingStudentIdentity(item.student)
    const liveElsewhere = cell.desks.some((desk) => desk.lesson?.studentSlots.some((student) => student && templatePendingStudentIdentity(student) === identity))
    // 1. 元の机に残す。
    if (!liveElsewhere && ownDesk && !isPendingDesk(ownDesk)) {
      const seat = pickFreeSeat(ownDesk, item.seatIndex)
      if (seat >= 0) {
        placeIntoDesk(ownDesk, seat, item.student, item.deskIndex)
        outcomes.push({ student: item.student, deskIndex: item.deskIndex, placedDeskIndex: item.deskIndex, placement: 'kept', teacherless: !ownDesk.teacher.trim() })
        continue
      }
    }
    // 2. 同じコマの空き席へずらす（講師が居る机 → 講師の居ない机・机番号順）。
    const candidates = [
      ...cell.desks.map((desk, index) => ({ desk, index })).filter(({ desk, index }) => index !== item.deskIndex && desk.teacher.trim()),
      ...cell.desks.map((desk, index) => ({ desk, index })).filter(({ desk, index }) => index !== item.deskIndex && !desk.teacher.trim()),
    ]
    let shifted = false
    for (const { desk, index } of candidates) {
      if (liveElsewhere) break
      if (isPendingDesk(desk)) continue
      const seat = pickFreeSeat(desk, item.seatIndex)
      if (seat < 0) continue
      placeIntoDesk(desk, seat, item.student, index)
      outcomes.push({ student: item.student, deskIndex: item.deskIndex, placedDeskIndex: index, placement: 'shifted', teacherless: !desk.teacher.trim() })
      shifted = true
      break
    }
    if (shifted) continue
    // 3. 同じ机番号の机の下段へ（埋まっていれば次の机の下段）＝Q42 の共通手順 placeIntoPendingLower。
    const placed = placeIntoPendingLower({
      cell, pendingDesks: nextPendingDesks, preferredDeskIndex: item.deskIndex, preferredSeat: item.seatIndex, student: item.student,
      effectiveStartDate: params.targetDateKey, createdAt: params.createdAt, kind: 'whole-day-transfer-displaced', note: buildWholeDayTransferDisplacedNote(params.sourceDateKey, params.targetDateKey),
    })
    if (placed) {
      nextPendingDesks = placed.nextPendingDesks
      const desk = cell.desks[placed.deskIndex]
      outcomes.push({ student: item.student, deskIndex: item.deskIndex, placedDeskIndex: placed.deskIndex, placement: 'pending', teacherless: !desk?.teacher.trim() })
      continue
    }
    // 全机の下段まで埋まる形は、事前ブロック（振替先に保留なし）のもとでは 1 机 2 席×机数を超える押し出しが要るので起きない。
    // それでも黙って消さず、呼び出し側へ返して従来どおり処分（確認ダイアログに件数が出る）する。
    overflow.push(item)
  }
  return { outcomes, nextPendingDesks, overflow }
}

/** 確認ダイアログ・結果メッセージの件数と名前。 */
export function summarizeWholeDayTransferDisplaced(outcomes: readonly WholeDayTransferDisplacedOutcome[]) {
  // 講師の開示（regression-reviewer M-1・2026-10-25）: 振替先の講師は従来どおり移送で上書き／削除記録になるので、残した授業の講師は移ってきた講師に替わる。
  // 講師の居ない机に残す（残る）ときは「(講師なし)」を添える（Q40-2 の「講師のいない机なので講師を付けてください」と同じ扱い。下段は講師を持たないので付けない）。
  const label = (o: WholeDayTransferDisplacedOutcome) => `${o.student.lessonType === 'trial' ? '体験' : o.student.lessonType === 'extra' ? '増コマ' : '手動追加'}:${o.student.name}${o.placement !== 'pending' && o.teacherless ? '(講師なし)' : ''}`
  return {
    keptCount: outcomes.filter((o) => o.placement === 'kept').length,
    shiftedCount: outcomes.filter((o) => o.placement === 'shifted').length,
    pendingCount: outcomes.filter((o) => o.placement === 'pending').length,
    names: outcomes.map(label),
  }
}
