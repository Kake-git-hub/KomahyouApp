// 盤面の上の帯に出す結果メッセージ(オーナー指示 2026-10-25「三行以上の長文を 1 行に。ユーザーはほとんど見ない」)。
// 何をしたか＋件数だけを 1 行にまとめる。0 件の内訳は出さない。

/** 「（A・B）」の形に括る。空の要素は落とし、全部空なら ''。 */
export function joinResultNotes(notes: ReadonlyArray<string>): string {
  const shown = notes.filter((note) => note)
  return shown.length > 0 ? `（${shown.join('・')}）` : ''
}

export function buildAutoAssignResultMessage(params: {
  displayName: string
  includeMakeup: boolean
  placedLecture: number
  placedMakeup: number
  remainingLecture: number
  remainingMakeup: number
}): string {
  const { displayName, includeMakeup, placedLecture, placedMakeup, remainingLecture, remainingMakeup } = params
  const placed = includeMakeup ? `講習${placedLecture}・振替${placedMakeup}コマ` : `${placedLecture}コマ`
  const remaining = includeMakeup
    ? joinResultNotes([remainingLecture > 0 ? `講習${remainingLecture}` : '', remainingMakeup > 0 ? `振替${remainingMakeup}` : '']).replace(/^（/u, '').replace(/）$/u, '')
    : (remainingLecture > 0 ? `${remainingLecture}` : '')
  return `${displayName} を自動割振しました（${placed}${remaining ? `・候補なしで残り ${remaining}${includeMakeup ? '' : 'コマ'}` : ''}）。`
}

export function buildHolidayReleaseResultMessage(params: {
  dateKey: string
  isClosedWeekday: boolean
  restoredCount: number
  removedMakeupCount: number
  skippedCount: number
  skippedSummary: string
}): string {
  const { dateKey, isClosedWeekday, restoredCount, removedMakeupCount, skippedCount, skippedSummary } = params
  return `${dateKey} の${isClosedWeekday ? '休校' : '休日'}を解除しました${joinResultNotes([
    restoredCount > 0 ? `元の席へ ${restoredCount}件` : '',
    removedMakeupCount > 0 ? `別日のコマ ${removedMakeupCount}件を削除` : '',
    skippedCount > 0 ? `戻せない ${skippedCount}件${skippedSummary ? `: ${skippedSummary}` : ''}` : '',
  ])}。`
}

export function buildWholeDayTransferResultMessage(params: {
  sourceDateKey: string
  targetDateKey: string
  movedStudentCount: number
  movedTeacherCount: number
  returnedCount: number
}): string {
  const { sourceDateKey, targetDateKey, movedStudentCount, movedTeacherCount, returnedCount } = params
  return `${sourceDateKey} → ${targetDateKey} へ丸ごと振替しました${joinResultNotes([
    `生徒${movedStudentCount}・講師${movedTeacherCount}`,
    returnedCount > 0 ? `未消化へ ${returnedCount}件` : '',
  ])}。`
}
