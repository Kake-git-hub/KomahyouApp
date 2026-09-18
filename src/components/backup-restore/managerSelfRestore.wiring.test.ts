// 室長の自教室復元の配線ガード(source-scan・2026-09-18・docs/spec-save-restore.md §4-1)。
//
// ⚠️ 本番データ保護: 復元は 2026-06-06 に教室取り違え事故を起こした最重要の慎重操作。描画テスト環境が無いので、
// 落とすと事故になる配線(他教室IDを受け取らない／確認モーダルを経ないと読み込まない／サーバーへ直接書かない／フラグで入口を閉じる)を
// App.tsx・BackupRestoreScreen.tsx の字面で固定する(作法は parentPortal.wiring.test.ts と同じ)。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const APP_TSX = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8')
const SCREEN_TSX = readFileSync(fileURLToPath(new URL('./BackupRestoreScreen.tsx', import.meta.url)), 'utf8')
const APP_CSS = readFileSync(fileURLToPath(new URL('../../App.css', import.meta.url)), 'utf8')
const ADMIN_FUNCTIONS_TS = readFileSync(fileURLToPath(new URL('../../integrations/firebase/adminFunctions.ts', import.meta.url)), 'utf8')

function sliceBetween(startNeedle: string, endNeedle: string): string {
  const start = APP_TSX.indexOf(startNeedle)
  expect(start).toBeGreaterThan(0)
  const end = APP_TSX.indexOf(endNeedle, start)
  expect(end).toBeGreaterThan(start)
  return APP_TSX.slice(start, end)
}

// 準備(取得して確認待ちにする)と、確定操作(確認モーダルで押したときだけ読み込む)の 2 段。
const slicePrepare = () => sliceBetween('const prepareOwnClassroomRestore = useCallback(', 'const cancelOwnClassroomRestore = useCallback(')
const sliceConfirm = () => sliceBetween('const confirmOwnClassroomRestore = useCallback(', 'const exportBasicDataTemplate = useCallback(')

describe('室長の自教室復元の配線(App.tsx)', () => {
  it('入口フラグはリモート有効 ＋ managerSelfRestore の両方で判定する', () => {
    expect(APP_TSX).toContain("isRemoteBackendEnabled && isFeatureEnabledForClassroom('managerSelfRestore', actingClassroom)")
  })

  it('準備ハンドラは教室IDを引数に取らない(復元元も復元先も actingClassroomId 固定)', () => {
    const prepare = slicePrepare()
    expect(prepare).toContain('async (backupDateKey: string) => {')
    expect(prepare).toContain('const restoreClassroomId = actingClassroomId')
    expect(prepare).toContain('downloadClassroomFromFirebaseServerAutoBackup(backupDateKey, restoreClassroomId)')
  })

  it('準備: ガード → 取得 → 教室ID照合 → 確認待ちに保持、の順。ここでは画面のデータを書き換えない', () => {
    const prepare = slicePrepare()
    const order = [
      'resolveManagerSelfRestoreGuard({',
      'await downloadClassroomFromFirebaseServerAutoBackup(',
      'isRestoreSourceForClassroom(source.classroomId, restoreClassroomId)',
      'setManagerSelfRestorePending({',
    ].map((needle) => prepare.indexOf(needle))
    order.forEach((index) => expect(index).toBeGreaterThan(0))
    expect([...order].sort((left, right) => left - right)).toEqual(order)
    // 取得中に開いている教室が変わったら確認待ちにしない。
    expect(prepare).toContain('actingClassroomIdRef.current !== restoreClassroomId')
    // 準備段では読み込まない(確認モーダルを必ず挟む・オーナー指示 2026-09-18)。
    expect(prepare).not.toContain('applyClassroomPayloadToState(')
    expect(prepare).not.toContain('setWorkspaceClassrooms(')
    expect(prepare).not.toContain('saveUndoSnapshot(')
    expect(prepare).toContain('confirmation: buildManagerSelfRestoreConfirmation({')
  })

  it('確定操作: 確認待ちが無ければ何もしない → 取得した教室IDでもう一度 3 者一致を照合 → Undo を取ってから読込', () => {
    const confirm = sliceConfirm()
    const order = [
      'if (!pending) return',
      'resolveManagerSelfRestoreGuard({',
      'targetClassroomId: pending.classroomId',
      "saveUndoSnapshot(`サーバーバックアップ復元",
      'applyClassroomPayloadToState(restoredPayload',
    ].map((needle) => confirm.indexOf(needle))
    order.forEach((index) => expect(index).toBeGreaterThan(0))
    expect([...order].sort((left, right) => left - right)).toEqual(order)
    expect(confirm).toContain('actingClassroomId: actingClassroomIdRef.current')
  })

  it('室長ガードへ担当教室と開いている教室を渡す(3 者一致の判定材料を落とさない・準備と確定の両方)', () => {
    for (const body of [slicePrepare(), sliceConfirm()]) {
      expect(body).toContain('role: currentUser?.role')
      expect(body).toContain('assignedClassroomId: currentUser?.assignedClassroomId')
    }
  })

  it('サーバーへ直接書かない(確定は既存の保存経路だけ)・書き換えるのは自教室のスロットだけ', () => {
    const confirm = sliceConfirm()
    for (const body of [slicePrepare(), confirm]) {
      expect(body).not.toContain('saveClassroomSnapshotViaFunction')
      expect(body).not.toContain('markStateLoadedClean')
    }
    expect(confirm).toContain('replaceClassroomData(current, restoreClassroomId, restoredPayload)')
    expect(confirm).toContain('loadedEditingClassroomIdRef.current = restoreClassroomId')
  })

  it('自教室の復元なので他教室コピー用のトークン剥がしは通さない(参照共有を断つクローンは行う)', () => {
    const prepare = slicePrepare()
    expect(prepare).not.toMatch(/buildDevelopmentClassroomCopyPayload\(/u)
    expect(prepare).toContain("sanitizeClassroomPayload({ ...cloneInitialValue(source.data), screen: 'board' })")
  })

  it('パスワード再認証は要求しない(オーナー指示 2026-09-18: 確認モーダルへ変更)', () => {
    for (const body of [slicePrepare(), sliceConfirm()]) expect(body).not.toContain('reauthenticateFirebaseUser')
  })

  it('確認待ちの復元データは Undo と同じ 3 経路(教室を開き直す・ワークスペース読込・ログアウト)で破棄する', () => {
    // 8316830 / v1.5.300 の教訓: 前の状態のデータをメモリに残すものは、全経路で対称に捨てる(1 箇所だけにしない)。
    for (const startNeedle of ['const openClassroom = useCallback(', 'const applyWorkspaceSnapshot = useCallback(', 'const logout = useCallback(']) {
      const body = sliceBetween(startNeedle, '\n  }, [')
      expect(body, startNeedle).toContain('setUndoSnapshot(null)')
      expect(body, startNeedle).toContain('setManagerSelfRestorePending(null)')
    }
  })

  it('確定操作は確認待ちをまず消費し(再入防止)、バックアップ/復元画面以外からは読み込まない', () => {
    const confirm = sliceConfirm()
    const consumeIndex = confirm.indexOf('setManagerSelfRestorePending(null)')
    const screenIndex = confirm.indexOf("if (screenRef.current !== 'backup-restore') return")
    const applyIndex = confirm.indexOf('applyClassroomPayloadToState(restoredPayload')
    expect(consumeIndex).toBeGreaterThan(0)
    expect(screenIndex).toBeGreaterThan(consumeIndex)
    expect(applyIndex).toBeGreaterThan(screenIndex)
  })

  it('一覧は直近 3 日の範囲問い合わせ＋純関数フィルタで作る', () => {
    expect(APP_TSX).toContain('listRecentFirebaseServerAutoBackupSummaries(resolveManagerSelfRestoreCutoffIso(now))')
    expect(APP_TSX).toContain('listManagerSelfRestoreCandidates(summaries, now)')
  })

  it('一覧取得(loadManagerSelfRestoreCandidates)も同じガードを通す', () => {
    const start = APP_TSX.indexOf('const loadManagerSelfRestoreCandidates = useCallback(')
    expect(start).toBeGreaterThan(0)
    const body = APP_TSX.slice(start, APP_TSX.indexOf('const prepareOwnClassroomRestore = useCallback(', start))
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
    expect(APP_TSX).toContain('managerSelfRestoreConfirmation={managerSelfRestorePending?.confirmation ?? null}')
    expect(APP_TSX).toContain('onConfirmOwnClassroomRestore={confirmOwnClassroomRestore}')
    expect(APP_TSX).toContain('onCancelOwnClassroomRestore={cancelOwnClassroomRestore}')
  })
})

describe('室長の自教室復元の配線(BackupRestoreScreen.tsx)', () => {
  it('パネルはフラグ ON のときだけ描く', () => {
    expect(SCREEN_TSX).toContain('{managerSelfRestoreEnabled ? (')
    expect(SCREEN_TSX).toContain('data-testid="backup-restore-self-restore-panel"')
  })

  it('確認モーダルは確認待ちがあるときだけ出し、「復元しても戻らないもの」を描く。パスワード欄は無い', () => {
    expect(SCREEN_TSX).toContain('{managerSelfRestoreEnabled && managerSelfRestoreConfirmation ? (')
    expect(SCREEN_TSX).toContain('self-restore-confirm-modal')
    expect(SCREEN_TSX).toContain('role="alertdialog"')
    expect(SCREEN_TSX).toContain('managerSelfRestoreConfirmation.notRestoredItems.map(')
    expect(SCREEN_TSX).toContain('onConfirmOwnClassroomRestore?.()')
    expect(SCREEN_TSX).toContain('onCancelOwnClassroomRestore?.()')
    expect(SCREEN_TSX).not.toContain('type="password"')
  })

  it('確認モーダルは大きく出す(幅・文字サイズを専用クラスで上書き)', () => {
    const start = APP_CSS.indexOf('.auto-assign-modal.self-restore-confirm-modal {')
    expect(start).toBeGreaterThan(0)
    const rule = APP_CSS.slice(start, APP_CSS.indexOf('}', start))
    expect(rule).toContain('max-width: 760px')
    expect(rule).toContain('font-size: 17px')
  })
})
