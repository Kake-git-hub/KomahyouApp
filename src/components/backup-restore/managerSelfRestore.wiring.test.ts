// 室長の自教室復元の配線ガード(source-scan・2026-09-18・docs/spec-save-restore.md §4-1)。
//
// ⚠️ 本番データ保護: 復元は 2026-06-06 に教室取り違え事故を起こした最重要の慎重操作。描画テスト環境が無いので、
// 落とすと事故になる配線(他教室IDを受け取らない／再認証が取得より先／サーバーへ直接書かない／フラグで入口を閉じる)を
// App.tsx・BackupRestoreScreen.tsx の字面で固定する(作法は parentPortal.wiring.test.ts と同じ)。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const APP_TSX = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8')
const SCREEN_TSX = readFileSync(fileURLToPath(new URL('./BackupRestoreScreen.tsx', import.meta.url)), 'utf8')
const ADMIN_FUNCTIONS_TS = readFileSync(fileURLToPath(new URL('../../integrations/firebase/adminFunctions.ts', import.meta.url)), 'utf8')

function sliceHandler(): string {
  const start = APP_TSX.indexOf('const restoreOwnClassroomFromServerBackup = useCallback(')
  expect(start).toBeGreaterThan(0)
  const end = APP_TSX.indexOf('const exportBasicDataTemplate = useCallback(', start)
  expect(end).toBeGreaterThan(start)
  return APP_TSX.slice(start, end)
}

describe('室長の自教室復元の配線(App.tsx)', () => {
  it('入口フラグはリモート有効 ＋ managerSelfRestore の両方で判定する', () => {
    expect(APP_TSX).toContain("isRemoteBackendEnabled && isFeatureEnabledForClassroom('managerSelfRestore', actingClassroom)")
  })

  it('ハンドラは教室IDを引数に取らない(復元元も復元先も actingClassroomId 固定)', () => {
    const handler = sliceHandler()
    expect(handler).toContain('async (backupDateKey: string, password: string): Promise<ManagerSelfRestoreResult>')
    expect(handler).toContain('const restoreClassroomId = actingClassroomId')
    expect(handler).toContain('downloadClassroomFromFirebaseServerAutoBackup(backupDateKey, restoreClassroomId)')
  })

  it('ガード → パスワード再認証 → 取得 → 教室ID照合 → 最終確認 → 読込 の順で進む', () => {
    const handler = sliceHandler()
    const order = [
      'resolveManagerSelfRestoreGuard({',
      'await reauthenticateFirebaseUser(password)',
      'await downloadClassroomFromFirebaseServerAutoBackup(',
      'isRestoreSourceForClassroom(source.classroomId, restoreClassroomId)',
      'window.confirm(buildManagerSelfRestoreConfirmLines({',
      "saveUndoSnapshot(`サーバーバックアップ復元",
      'applyClassroomPayloadToState(restoredPayload',
    ].map((needle) => handler.indexOf(needle))
    order.forEach((index) => expect(index).toBeGreaterThan(0))
    expect([...order].sort((left, right) => left - right)).toEqual(order)
    // 取得中に開いている教室が変わったら読み込まない。
    expect(handler).toContain('actingClassroomIdRef.current !== restoreClassroomId')
  })

  it('室長ガードへ担当教室と開いている教室を渡す(3 者一致の判定材料を落とさない)', () => {
    const handler = sliceHandler()
    expect(handler).toContain('role: currentUser?.role')
    expect(handler).toContain('assignedClassroomId: currentUser?.assignedClassroomId')
  })

  it('サーバーへ直接書かない(確定は既存の保存経路だけ)・書き換えるのは自教室のスロットだけ', () => {
    const handler = sliceHandler()
    expect(handler).not.toContain('saveClassroomSnapshotViaFunction')
    expect(handler).not.toContain('markStateLoadedClean')
    expect(handler).toContain('replaceClassroomData(current, restoreClassroomId, restoredPayload)')
    expect(handler).toContain('loadedEditingClassroomIdRef.current = restoreClassroomId')
  })

  it('自教室の復元なので他教室コピー用のトークン剥がしは通さない(参照共有を断つクローンは行う)', () => {
    const handler = sliceHandler()
    expect(handler).not.toContain('buildDevelopmentClassroomCopyPayload')
    expect(handler).toContain("sanitizeClassroomPayload({ ...cloneInitialValue(source.data), screen: 'board' })")
  })

  it('一覧は直近 7 日の範囲問い合わせ＋純関数フィルタで作る', () => {
    expect(APP_TSX).toContain('listRecentFirebaseServerAutoBackupSummaries(resolveManagerSelfRestoreCutoffIso(now))')
    expect(APP_TSX).toContain('listManagerSelfRestoreCandidates(summaries, now)')
  })

  it('一覧取得(loadManagerSelfRestoreCandidates)も同じガードを通す', () => {
    const start = APP_TSX.indexOf('const loadManagerSelfRestoreCandidates = useCallback(')
    expect(start).toBeGreaterThan(0)
    const body = APP_TSX.slice(start, APP_TSX.indexOf('const restoreOwnClassroomFromServerBackup = useCallback(', start))
    const guardIndex = body.indexOf('resolveManagerSelfRestoreGuard({')
    const listIndex = body.indexOf('listRecentFirebaseServerAutoBackupSummaries(')
    expect(guardIndex).toBeGreaterThan(0)
    expect(listIndex).toBeGreaterThan(guardIndex)
  })

  it('一覧の問い合わせは savedAt の範囲＋同じフィールドの並べ替え(複合インデックス不要の形を保つ・2026-09-12 の教訓)', () => {
    const start = ADMIN_FUNCTIONS_TS.indexOf('export async function listRecentFirebaseServerAutoBackupSummaries(')
    expect(start).toBeGreaterThan(0)
    const body = ADMIN_FUNCTIONS_TS.slice(start, start + 900)
    expect(body).toContain("query(summariesRef, where('savedAt', '>=', sinceIso), orderBy('savedAt', 'desc'))")
    expect(body).not.toContain('documentId()')
  })

  it('兄弟経路(他教室バックアップ読込 = Feature B)も応答の教室ID照合と教室切替検知を通す', () => {
    const start = APP_TSX.indexOf('const loadClassroomBackupIntoDevelopment = useCallback(')
    expect(start).toBeGreaterThan(0)
    const body = APP_TSX.slice(start, APP_TSX.indexOf('const loadManagerSelfRestoreCandidates = useCallback(', start))
    expect(body).toContain('isRestoreSourceForClassroom(source.classroomId, sourceClassroomId)')
    expect(body).toContain('actingClassroomIdRef.current !== loadTargetClassroomId')
    // Feature B は他教室のデータなのでトークン剥がしを通す(自教室復元と逆)。
    expect(body).toContain('buildDevelopmentClassroomCopyPayload(source.data)')
  })

  it('復元画面へフラグとハンドラを渡す', () => {
    expect(APP_TSX).toContain('managerSelfRestoreEnabled={managerSelfRestoreEnabled}')
    expect(APP_TSX).toContain('onRestoreOwnClassroomFromBackup={restoreOwnClassroomFromServerBackup}')
  })
})

describe('室長の自教室復元の配線(BackupRestoreScreen.tsx)', () => {
  it('パネルはフラグ ON のときだけ描く', () => {
    expect(SCREEN_TSX).toContain('{managerSelfRestoreEnabled ? (')
    expect(SCREEN_TSX).toContain('data-testid="backup-restore-self-restore-panel"')
  })

  it('パスワード未入力では実行しない・パスワード違いはモーダルに残して打ち直せる', () => {
    expect(SCREEN_TSX).toContain('if (!selfRestorePassword) {')
    expect(SCREEN_TSX).toContain("if (!result.ok && result.reason === 'password') {")
    expect(SCREEN_TSX).toContain('type="password"')
    expect(SCREEN_TSX).toContain('MANAGER_SELF_RESTORE_MODAL_NOTES.map(')
  })
})
