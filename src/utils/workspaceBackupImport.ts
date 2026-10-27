// ワークスペース形式のバックアップ JSON(サーバー自動バックアップ・復元前の控え)を教室画面の「JSON 読込」に流すとき、
// どの教室のデータを採るかを決める純関数(2026-10-27・regression-reviewer M-3・INV-08)。
//
// ★なぜ作ったか: 旧実装は「開いている教室が無ければ先頭の教室」に落ちていた。サーバー自動バックアップは全教室を必ず含んでいたので
//   実質届かなかったが、週単位の分割保存の段階 A から「組み立てられない教室を除いて書く」(missingClassroomIds)バックアップが生まれ、
//   開いている教室が除かれた JSON を読み込むと**別教室のデータ**が開いている教室へ入る道ができた。開いている教室があるのに
//   その教室が JSON に無ければ止める(先頭教室へ落とさない)。
import type { WorkspaceClassroom, WorkspaceSnapshot } from '../types/appState'

export type WorkspaceBackupImportTarget =
  | { ok: true; classroom: WorkspaceClassroom }
  | { ok: false; message: string }

/** バックアップ JSON に載る「組み立てられず除いた教室」(サーバー buildWorkspaceServerBackupSnapshot が書く)。無ければ空。 */
export function readWorkspaceBackupMissingClassroomIds(snapshot: unknown): string[] {
  const raw = (snapshot as { missingClassroomIds?: unknown } | null | undefined)?.missingClassroomIds
  return Array.isArray(raw) ? raw.filter((entry): entry is string => typeof entry === 'string') : []
}

export function resolveWorkspaceBackupImportTarget(snapshot: WorkspaceSnapshot, actingClassroomId: string | null): WorkspaceBackupImportTarget {
  if (actingClassroomId) {
    const classroom = snapshot.classrooms.find((entry) => entry.id === actingClassroomId)
    if (classroom) return { ok: true, classroom }
    const missing = readWorkspaceBackupMissingClassroomIds(snapshot)
    if (missing.includes(actingClassroomId)) {
      return { ok: false, message: 'このバックアップには、開いている教室のデータが入っていません(バックアップ時にこの教室のデータを読み込めなかったため)。別の時刻のバックアップを選ぶか、開発者へご連絡ください。' }
    }
    return { ok: false, message: 'このバックアップには、開いている教室のデータが入っていません。' }
  }
  const first = snapshot.classrooms[0]
  if (!first) return { ok: false, message: 'バックアップに教室データが含まれていません。' }
  return { ok: true, classroom: first }
}
