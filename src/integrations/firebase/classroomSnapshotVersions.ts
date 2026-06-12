// A1: 教室ごとの「サーバー保存の版数(version)」をこのタブが把握しておくためのレジストリ。
//
// 役割:
//  - 読込時(loadFirebaseWorkspaceSnapshot)に、各教室の現在の版数をここへ記録する。
//  - 保存時(saveClassroomSnapshotViaFunction)に baseVersion として送り、成功したら返ってきた
//    新版数で更新する。
// これにより「別端末が先に保存した最新を、古い版数で上書きする」のをサーバー側で弾ける。
//
// 単純なモジュールスコープの Map。1ブラウザ(1タブ)につき1インスタンス、classroomId はグローバルに一意。
// アカウント切替/再読込時は loadFirebaseWorkspaceSnapshot 冒頭で clear してから現値をセットする。

const classroomVersions = new Map<string, number>()

export function getClassroomSnapshotVersion(classroomId: string): number | undefined {
  if (!classroomId) return undefined
  return classroomVersions.get(classroomId)
}

export function setClassroomSnapshotVersion(classroomId: string, version: number | undefined): void {
  if (!classroomId) return
  if (typeof version !== 'number' || !Number.isFinite(version)) return
  classroomVersions.set(classroomId, version)
}

export function clearClassroomSnapshotVersions(): void {
  classroomVersions.clear()
}
