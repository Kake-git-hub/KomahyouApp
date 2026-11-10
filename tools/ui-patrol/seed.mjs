// 画面の自動巡回(tools/ui-patrol.mjs・docs/test-strategy.md 層 5)の種データ。
// 伏せ字の教室データ(AppSnapshotPayload)1 つを、ローカルモードのアプリが読む教室データ一式(WorkspaceSnapshot)に包む。
//
// ★なぜこの形か
//   - 巡回は「室長がいつも開くときと同じ読み込み経路」でアプリを開く(読み込みのためにアプリ本体は変えない)。
//     そのため、室長でログイン済み(currentUserId)・担当教室(assignedClassroomId)を開いている(actingClassroomId)形にし、
//     開いた画面が盤面になるよう data.screen を board にする。
//   - 利用者は架空の室長と開発者だけ。メールは配送されない予約ドメイン example.invalid にし、実在の値を持たない。
//   - 開発者のパスワードは入れない(読み込み側 parseWorkspaceSnapshot が既定を補う)。
// ★入力の payload は書き換えない。伏せ字は呼び出し側(anonymize.ts)の責任で、ここでは名前を扱わない。

export const PATROL_MANAGER_USER_ID = 'patrol_manager'
export const PATROL_DEVELOPER_USER_ID = 'patrol_developer'
export const PATROL_CLASSROOM_NAME = '巡回用教室'

/** 伏せ字の教室データ 1 つから、ローカルモードが読める教室データ一式（WorkspaceSnapshot）を作る。 */
export function buildPatrolWorkspaceSnapshot({ classroomId, payload, savedAt }) {
  if (typeof classroomId !== 'string' || !classroomId) throw new Error('classroomId を指定してください。')
  if (!payload || typeof payload !== 'object') throw new Error('payload(教室データ)を指定してください。')
  const stamp = typeof savedAt === 'string' && savedAt ? savedAt : new Date().toISOString()
  const data = { ...structuredClone(payload), screen: 'board' }
  return {
    schemaVersion: 1,
    savedAt: stamp,
    developerCloudBackupEnabled: false,
    developerCloudBackupFolderName: '',
    developerCloudSyncedAutoBackupKeys: [],
    currentUserId: PATROL_MANAGER_USER_ID,
    actingClassroomId: classroomId,
    users: [
      { id: PATROL_DEVELOPER_USER_ID, name: '巡回用開発者', email: 'patrol-developer@example.invalid', role: 'developer', assignedClassroomId: null },
      { id: PATROL_MANAGER_USER_ID, name: '巡回用室長', email: 'patrol-manager@example.invalid', role: 'manager', assignedClassroomId: classroomId },
    ],
    classrooms: [
      {
        id: classroomId,
        name: PATROL_CLASSROOM_NAME,
        contractStatus: 'active',
        // 契約の開始日は保存時刻の日付(未来の契約で教室が閉じないよう、データの時点より後にしない)。
        contractStartDate: stamp.slice(0, 10),
        contractEndDate: '',
        managerUserId: PATROL_MANAGER_USER_ID,
        isTemporarilySuspended: false,
        temporarySuspensionReason: '',
        data,
      },
    ],
  }
}
