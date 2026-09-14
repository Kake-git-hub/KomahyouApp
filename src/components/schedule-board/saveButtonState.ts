// 右上の保存ボタンの状態(data-state)。色は App.css が data-state ごとに当てる。
// 2026-09-14 オーナー指示: 保存(未保存あり)・保存中 = 赤 / 最新データ(保存済み) = 緑。
// (旧仕様「青固定＋ラベルで状態表現」2026-08-29 を改定。spec-save-restore.md §1)
export type SaveBoardButtonState = 'saving' | 'dirty' | 'clean'

export function resolveSaveBoardButtonState(params: { isSavingInProgress: boolean; hasPendingSave: boolean }): SaveBoardButtonState {
  if (params.isSavingInProgress) return 'saving'
  return params.hasPendingSave ? 'dirty' : 'clean'
}
