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
//
// ⚠️ 回帰防止(2026-06-27 本番データ消失): この反映は「追加(union)のみ・削減しない」。
// 購読 entry の groupClassParticipation / optionChecks は購読側で常に定義済み(空でも {})で届く
// (lectureSubmission.ts subscribeLectureSubmissions: `?? {}`)。以前は `entry ?? existing ?? {}`
// としていたため、提出ドキュメントが空 {}(室長が v1.5.335 以前に登録した中3は doc が空のまま)だと
// **登録済みローカルの集団参加/オプションを空で上書きして消した**。実害: 緑が丘5名・日大前2名の
// 集団参加(集団理科/集団社会)が、起動直後の初回スナップショット反映で一括 {} に消失
// (全員 updatedAt が同一=1回の setSpecialSessions 反映で消えたことを示す)。
// この経路は countSubmitted=true(=提出ロック済み)の生徒にだけ走るため、保護者が QR で参加を
// 「外す」ことは起こり得ない(ロック後は編集不可)。よって反映は union で十分かつ安全であり、
// 室長が決めた値を消さない。室長による削減は日程表ダイアログ(別経路 schedule-student-count-save)
// で行われ、ローカル/doc を直接更新するためこの関数は通らない。

type BoolMap = Record<string, boolean>

function trueKeys(map: BoolMap | undefined): string[] {
  if (!map) return []
  return Object.keys(map).filter((key) => map[key] === true)
}

// true のキー集合を正規化した署名。提出値は true のみ保持(関数側 sanitize 済み)のため、
// true キー集合が一致すれば実質同値とみなせる。
function trueKeySignature(map: BoolMap | undefined): string {
  return trueKeys(map).sort().join(',')
}

// 既存とentryの true キーを和集合(union)した BoolMap。削減はしない(回帰防止: 上記コメント参照)。
function unionTrueKeys(existing: BoolMap | undefined, entry: BoolMap | undefined): BoolMap {
  const result: BoolMap = {}
  for (const key of trueKeys(existing)) result[key] = true
  for (const key of trueKeys(entry)) result[key] = true
  return result
}

export type ParentOwnedSubmissionFields = {
  optionChecks?: BoolMap
  groupClassParticipation?: BoolMap
}

/**
 * 登録済み(countSubmitted)生徒に対し、保護者所有フィールド(optionChecks /
 * groupClassParticipation)を最新提出値とローカルの和集合(union)で算出する。
 * **削減はしない**(空 doc による上書き消失を防ぐ・上部コメントの回帰防止参照)。
 * 変化が無ければ null を返す(不要な再描画・dirty 化を避けるため)。
 * 変化があれば反映すべき値を返す(呼び出し側で既存 input に展開する)。
 */
export function reflectParentOwnedSubmissionFields(
  existing: ParentOwnedSubmissionFields,
  entry: ParentOwnedSubmissionFields,
): { optionChecks: BoolMap; groupClassParticipation: BoolMap } | null {
  const nextOptionChecks = unionTrueKeys(existing.optionChecks, entry.optionChecks)
  const nextGroupParticipation = unionTrueKeys(existing.groupClassParticipation, entry.groupClassParticipation)

  // union は既存を縮めないので、署名が伸びた(=新規 true が増えた)ときだけ変化とみなせる。
  const optionChanged = trueKeySignature(existing.optionChecks) !== trueKeySignature(nextOptionChecks)
  const groupChanged = trueKeySignature(existing.groupClassParticipation) !== trueKeySignature(nextGroupParticipation)
  if (!optionChanged && !groupChanged) return null

  return { optionChecks: nextOptionChecks, groupClassParticipation: nextGroupParticipation }
}
