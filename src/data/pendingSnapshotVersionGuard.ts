// A3(2026-07-06): 「割り振った講習が数分後に未配置へ戻る」多端末 stale 書き戻し不具合の是正。
//
// 背景（実在の穴・消してはならないガード）:
//   サーバーには教室単位の楽観ロック(optimisticVersion.ts)があり、baseVersion がサーバーの現在版数と
//   食い違えば stale として拒否する。ところが「前回終了時の未同期ローカルをログイン時に書き戻す」経路
//   (resolveRemoteWorkspaceSnapshot / resolvePendingLocalClassroomSnapshotForAuthenticatedUser)は、
//   直前に loadFirebaseWorkspaceSnapshot が版数レジストリを『サーバー最新版数』へ更新してしまうため、
//   書き戻し保存の baseVersion が最新版数になり、楽観ロックを素通りしてしまう。ゲートはワークスペース
//   全体の savedAt(クライアントの壁時計・端末間で数分ズレる)比較だけで、教室単位の版数を見ていない。
//   → 別端末が後から保存した最新教室データを、古いローカルが savedAt 勝ちで黙って上書きできる。
//   盤面(weeks)だけ古い状態へ戻る一方、提出(subjectSlots)は残るため、講習残数が満数へ戻って
//   「割り振ったのに戻る／残数が増える」症状になる。
//
// この純関数は「書き戻そうとしている教室が stale か」を版数で判定する。マーカー記録時点でのローカル
// 基準版数(baseVersion)よりサーバーの現在版数が進んでいれば、別端末が後から保存した＝ローカルは stale。
export function isPendingClassroomWriteBackStale(params: {
  classroomId: string
  baseClassroomVersions: Record<string, number> | undefined
  remoteClassroomVersions: Record<string, number> | undefined
}): boolean {
  const base = params.baseClassroomVersions?.[params.classroomId]
  const remote = params.remoteClassroomVersions?.[params.classroomId]
  // 版数情報が無い(旧マーカー / まだ version 未付与の教室)ときは、従来どおり savedAt ゲートに委ねる
  // (ここでは stale と判定しない＝既存の復元挙動を壊さない)。
  if (typeof base !== 'number' || typeof remote !== 'number') return false
  // サーバー版数がローカル基準版数より進んでいる = 別端末が後から保存済み = ローカルは stale。
  return remote > base
}

// 対象教室群のうち「stale でない(＝安全に書き戻せる)」教室IDだけを返す。
export function selectSafePendingWriteBackClassroomIds(params: {
  targetClassroomIds: string[]
  baseClassroomVersions: Record<string, number> | undefined
  remoteClassroomVersions: Record<string, number> | undefined
}): string[] {
  return params.targetClassroomIds.filter((classroomId) => !isPendingClassroomWriteBackStale({
    classroomId,
    baseClassroomVersions: params.baseClassroomVersions,
    remoteClassroomVersions: params.remoteClassroomVersions,
  }))
}
