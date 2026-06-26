// QR提出の取り込み(App.tsx の subscribeLectureSubmissions onSubmitted)で使う純関数。
//
// 背景: 生徒が既に登録済み(countSubmitted=true)だと、onSubmitted は届いた提出を丸ごとスキップ
// していた。しかし optionChecks / groupClassParticipation は「保護者が QR で決める＝常に最新の
// 提出値を反映すべき」フィールドで、これを握りつぶすと、室長アプリのローカル状態が古いまま
// 手動保存され、Cloud Function がスナップショットへ統合した正しい提出値を空で上書きして消す
// (実例: 岩佐s085 のQR optionChecks {0,1} がスナップショットで {} に消失)。
//
// そこで登録済みでも「保護者所有の2フィールドだけ」は最新提出値を反映する。回数・配置・出席不可
// 等の再実行はしない(既存ガードの意図＝重複適用や室長編集の保護は維持)。

type BoolMap = Record<string, boolean>

// true のキー集合を正規化した署名。提出値は true のみ保持(関数側 sanitize 済み)のため、
// true キー集合が一致すれば実質同値とみなせる。
function trueKeySignature(map: BoolMap | undefined): string {
  if (!map) return ''
  return Object.keys(map)
    .filter((key) => map[key] === true)
    .sort()
    .join(',')
}

export type ParentOwnedSubmissionFields = {
  optionChecks?: BoolMap
  groupClassParticipation?: BoolMap
}

/**
 * 登録済み(countSubmitted)生徒に対し、保護者所有フィールド(optionChecks /
 * groupClassParticipation)の最新提出値を算出する。
 * 変化が無ければ null を返す(不要な再描画・dirty 化を避けるため)。
 * 変化があれば反映すべき値を返す(呼び出し側で既存 input に展開する)。
 */
export function reflectParentOwnedSubmissionFields(
  existing: ParentOwnedSubmissionFields,
  entry: ParentOwnedSubmissionFields,
): { optionChecks: BoolMap; groupClassParticipation: BoolMap } | null {
  // entry 側は購読で常に定義済み(未設定でも {})。提出値を正としつつ、欠落時は既存を保全。
  const nextOptionChecks = entry.optionChecks ?? existing.optionChecks ?? {}
  const nextGroupParticipation = entry.groupClassParticipation ?? existing.groupClassParticipation ?? {}

  const optionChanged = trueKeySignature(existing.optionChecks) !== trueKeySignature(nextOptionChecks)
  const groupChanged = trueKeySignature(existing.groupClassParticipation) !== trueKeySignature(nextGroupParticipation)
  if (!optionChanged && !groupChanged) return null

  return { optionChecks: nextOptionChecks, groupClassParticipation: nextGroupParticipation }
}
