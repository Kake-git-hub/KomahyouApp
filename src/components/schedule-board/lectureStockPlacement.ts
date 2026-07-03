// 未消化講習の手動配置で「ユーザーが選んだ科目」を尊重するためのヘルパ。
//
// 背景(回帰防止): 講習の手動配置は長らく buildLecturePendingItems(entry)[0]（＝先頭科目）を
// 無条件に置いていた。生徒に未消化講習が1科目しかなければ [0] で正しいが、中3など複数科目を
// 持つ生徒では、モーダルで「数学」を選んでも先頭の「英語」が置かれる不具合になっていた
// (2026-07-03 報告)。振替(makeup)側が selectedMakeupStockRawKey で選択科目を尊重するのに対し
// 講習側にはその仕組みが無かった。ここで選択キー(subject + sessionId)一致で明示的に解決する。

export type LecturePlacementSelectionKey = {
  subject: string
  sessionId?: string
}

/**
 * pendingItems から、ユーザーが選択した科目(・セッション)に一致する項目を返す。
 * 未選択・不一致時は従来どおり先頭([0])へフォールバックする(安全側)。
 */
export function resolveSelectedLecturePlacementItem<T extends LecturePlacementSelectionKey>(
  pendingItems: T[],
  selectedKey: LecturePlacementSelectionKey | null | undefined,
): T | null {
  if (selectedKey) {
    const matched = pendingItems.find(
      (item) => item.subject === selectedKey.subject && (item.sessionId ?? '') === (selectedKey.sessionId ?? ''),
    )
    if (matched) return matched
  }
  return pendingItems[0] ?? null
}
