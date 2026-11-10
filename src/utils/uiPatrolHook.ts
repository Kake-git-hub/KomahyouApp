// 画面の自動巡回（tools/ui-patrol.mjs・docs/test-strategy.md 層 5）の読み口。
//
// ★なぜあるか
//   巡回の道具はブラウザの外（Playwright）から室長と同じ操作をし、操作のたびに盤面の状態を点検する。
//   画面の文字だけでは在庫・記録・出自の印が読めないため、App が保存に使うのと同じ教室データ一式を
//   window 越しに読める口を用意する。
//
// ★なぜ「開発用ビルド かつ ローカルモード」だけか
//   本番の利用者の端末に、外から教室データを読める口を出さないため。本番ビルドでは App.tsx 側の
//   `if (import.meta.env.DEV)` ごと消え、tools/check-dist-dev-hooks.mjs が dist にこの名前が残っていないかを見張る。
//   Firebase 接続時（staging 含む）も出さない（巡回は手元のローカルデータだけを相手にする）。
//
// このファイルは純関数だけ。import は型だけにして、本番ビルドに何も持ち込まないようにする。

import type { AppSnapshotPayload, WorkspaceSnapshot } from '../types/appState'

export const UI_PATROL_GLOBAL_KEY = '__komahyouUiPatrol'

export type UiPatrolClassroomRead = { classroomId: string; payload: AppSnapshotPayload }

export type UiPatrolHook = {
  version: 1
  backendMode: 'local'
  appVersion: string
  readClassroom: () => UiPatrolClassroomRead | null
}

/** 開発用ビルド かつ ローカルモードのときだけ true。 */
export function shouldInstallUiPatrolHook(params: { isDevBuild: boolean; backendEnabled: boolean }): boolean {
  return params.isDevBuild === true && params.backendEnabled === false
}

/** 教室データ一式から、今開いている教室の分だけを取り出す。無ければ null。 */
export function pickUiPatrolClassroom(
  snapshot: Pick<WorkspaceSnapshot, 'classrooms'>,
  classroomId: string | null,
): UiPatrolClassroomRead | null {
  if (!classroomId) return null
  const classroom = snapshot.classrooms.find((entry) => entry.id === classroomId)
  if (!classroom) return null
  return { classroomId: classroom.id, payload: classroom.data }
}

/** target[UI_PATROL_GLOBAL_KEY] に入れる。戻り値で外す（自分が入れたものだけ消す）。 */
export function installUiPatrolHook(target: object, hook: UiPatrolHook): () => void {
  const slot = target as Record<string, unknown>
  slot[UI_PATROL_GLOBAL_KEY] = hook
  return () => {
    // 再マウントで新しい読み口が先に入っていたら、古い方の後始末で新しい方を消さない。
    if (slot[UI_PATROL_GLOBAL_KEY] === hook) delete slot[UI_PATROL_GLOBAL_KEY]
  }
}
