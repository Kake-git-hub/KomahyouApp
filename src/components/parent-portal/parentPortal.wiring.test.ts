// 保護者向け固定QRの配線ガード(source-scan・2026-09-13・docs/spec-parent-portal.md §C/§E-2/§H)。
//
// ⚠️ 本番データ保護(INV-08): この機能は**開発用教室だけ**の第1段で、本番教室(日大前・緑が丘・薬円台)では
// QR の発行入口も保護者連絡の購読も動いてはいけない。また他教室コピー(開発用教室への読み込み)で
// 写しトークンが残ると、開発用教室の画面から**本番生徒の日程を返すQR**が出てしまう(講習提出トークンの
// 2026-07-09 事故と同型)。描画テスト環境が無いので、落としやすい配線を App.tsx / main.tsx の字面で固定する
// (作法は VerificationChecklistPanel.wiring.test.ts と同じ)。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const APP_TSX = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8')
const MAIN_TSX = readFileSync(fileURLToPath(new URL('../../main.tsx', import.meta.url)), 'utf8')

describe('保護者向け固定QRの配線(App.tsx)', () => {
  it('必要なモジュールを import している', () => {
    expect(APP_TSX).toContain("import { ParentMessagesModal } from './components/parent-portal/ParentMessagesModal'")
    expect(APP_TSX).toContain("from './integrations/firebase/parentPortal'")
    expect(APP_TSX).toContain('issueStudentPortalTokenViaFunction')
    expect(APP_TSX).toContain('revokeStudentPortalTokenViaFunction')
    expect(APP_TSX).toContain('markParentMessagesNotifiedViaFunction')
    expect(APP_TSX).toContain('subscribeParentMessages')
    expect(APP_TSX).toContain("from './utils/parentMessages'")
  })

  it('保存済みの生徒 id を基本データ画面へ渡す(追加直後の生徒の QR を保存待ちにする・2026-09-13)', () => {
    expect(APP_TSX).toContain("import { resolveSavedStudentIds } from './components/basic-data/parentPortalQr'")
    expect(APP_TSX).toContain('isClean: dataSignature === cleanSignature,')
    expect(APP_TSX).toContain('savedStudentIds={savedStudentIds}')
  })

  it('フラグはリモート有効 ＋ parentPortalQr の両方で判定する(ローカル/本番教室では無効)', () => {
    expect(APP_TSX).toContain("isRemoteBackendEnabled && isFeatureEnabledForClassroom('parentPortalQr', actingClassroom)")
  })

  it('他教室コピーのペイロードで写しトークンを剥がす(INV-08・単一権威の strip を使う)', () => {
    expect(APP_TSX).toContain('stripParentPortalTokensFromStudents')
    const copyFnIndex = APP_TSX.indexOf('export function buildDevelopmentClassroomCopyPayload')
    expect(copyFnIndex).toBeGreaterThan(0)
    const copyFnBody = APP_TSX.slice(copyFnIndex, copyFnIndex + 2500)
    expect(copyFnBody).toContain('students: stripParentPortalTokensFromStudents(')
    expect(copyFnBody).toContain('sanitizedSource.students')
    // 既存の提出トークン剥がしも同じ関数に残っていること(片方だけにしない)。
    expect(copyFnBody).toContain('stripSubmissionTokensFromInputs(session.studentInputs)')
  })

  it('購読はフラグ ON かつ教室が開いているときだけ動き、cleanup で休み連絡の状態をすべて捨てる(他教室の残留を防ぐ)', () => {
    const subscribeIndex = APP_TSX.indexOf('subscribeParentMessages(actingClassroomId')
    expect(subscribeIndex).toBeGreaterThan(0)
    const effect = APP_TSX.slice(Math.max(0, subscribeIndex - 600), subscribeIndex + 600)
    expect(effect).toContain('if (!isRemoteBackendEnabled || !actingClassroomId || !parentPortalQrEnabled) return')
    expect(effect).toContain('setParentMessageEntries(entries)')
    expect(effect).toContain('unsubscribe()')
    expect(effect).toContain('resetParentAbsenceNoticeState()')
    // 捨てる中身: 連絡の全件・保存待ち・盤面への一過性コマンド・エラー(前の教室の生徒名と保存待ちを持ち越さない・INV-08)。
    const resetIndex = APP_TSX.indexOf('const resetParentAbsenceNoticeState = useCallback')
    expect(resetIndex).toBeGreaterThan(0)
    const reset = APP_TSX.slice(resetIndex, resetIndex + 700)
    for (const call of ['setParentMessageEntries([])', 'setHiddenParentMessageIds([])', 'setPendingParentAbsenceFinalize([])', 'setParentAbsenceRequest(null)', 'setParentAbsenceErrors({})']) {
      expect(reset).toContain(call)
    }
  })

  it('一覧は「未処理の全件 − 保存待ち − 画面から外した分」で導出し、生徒名は名簿の現在名で組み立てる', () => {
    const memoIndex = APP_TSX.indexOf('const parentMessageNotifications = useMemo')
    expect(memoIndex).toBeGreaterThan(0)
    const memo = APP_TSX.slice(memoIndex, memoIndex + 900)
    expect(memo).toContain('pendingParentAbsenceFinalize.map((item) => item.messageId)')
    expect(memo).toContain('hiddenParentMessageIds')
    expect(memo).toContain('selectUnnotifiedParentMessages(parentMessageEntries, excludedIds)')
    expect(memo).toContain('buildParentMessageNotifications(unread, { students, classroomName: actingClassroom?.name })')
  })

  // オーナー確定(2026-09-18): 盤面を変える選択(休み/振無休/振替先)は、盤面を保存できた時点で処理済みにする。
  // 選んだ瞬間に 'notified' を送ると、保存し忘れて閉じたとき「連絡は処理済みなのに盤面は休みになっていない」が起きる。
  it("四択: 'manual' だけその場で 'notified' を送る。盤面を変える 3 種は盤面へ一過性コマンドを送るだけ", () => {
    const chooseIndex = APP_TSX.indexOf('const handleParentAbsenceChoice = useCallback')
    expect(chooseIndex).toBeGreaterThan(0)
    const body = APP_TSX.slice(chooseIndex, chooseIndex + 2200)
    const manualIndex = body.indexOf("if (resolution === 'manual') {")
    const requestIndex = body.indexOf('setParentAbsenceRequest({')
    expect(manualIndex).toBeGreaterThan(0)
    expect(requestIndex).toBeGreaterThan(manualIndex)
    const notifiedCalls = [...body.matchAll(/stage: 'notified'/gu)]
    expect(notifiedCalls).toHaveLength(1)
    expect(notifiedCalls[0]!.index).toBeGreaterThan(manualIndex)
    expect(notifiedCalls[0]!.index).toBeLessThan(requestIndex)
    // 盤面以外の画面で押されたら盤面へ移ってから処理する。二重実行は busy で止める。
    expect(body).toContain("if (screenRef.current !== 'board') navigateClassroomScreenRef.current('board')")
    expect(body).toContain('if (!classroomId || parentAbsenceBusyId !== null) return')
  })

  it('盤面の処理結果: 必ず一過性コマンドを消費し、成功なら保存待ちへ積んで acknowledged を送る(notified は送らない)', () => {
    const processedIndex = APP_TSX.indexOf('const handleParentAbsenceRequestProcessed = useCallback')
    expect(processedIndex).toBeGreaterThan(0)
    const body = APP_TSX.slice(processedIndex, processedIndex + 1900)
    // Issue #46 同型: 成功でも失敗でも最初に消費する(消費しないと盤面の再マウントで再発火する)。
    const consumeIndex = body.indexOf('setParentAbsenceRequest((current) => consumeParentAbsenceRequest(current, result.requestId))')
    const failIndex = body.indexOf('if (!result.ok) {')
    expect(consumeIndex).toBeGreaterThan(0)
    expect(failIndex).toBeGreaterThan(consumeIndex)
    expect(body).toContain('addPendingParentAbsenceFinalize(current, { messageId: result.messageId, classroomId, processedAt: new Date().toISOString() })')
    expect(body).toContain("stage: 'acknowledged', resolution: result.action")
    expect(body).not.toContain("stage: 'notified'")
  })

  it('保存の成功点(saveClassroomSnapshotViaFunction の直後)でだけ、保存待ちを処理済みにする', () => {
    const saveIndex = APP_TSX.indexOf('result = await saveClassroomSnapshotViaFunction({')
    expect(saveIndex).toBeGreaterThan(0)
    const afterSave = APP_TSX.slice(saveIndex, saveIndex + 1400)
    expect(afterSave).toContain('finalizeParentAbsenceNoticesAfterSaveRef.current(targetClassroom.id, nextItem.snapshot.savedAt)')
    const finalizeIndex = APP_TSX.indexOf('const finalizeParentAbsenceNoticesAfterSave = useCallback')
    expect(finalizeIndex).toBeGreaterThan(0)
    const finalize = APP_TSX.slice(finalizeIndex, finalizeIndex + 1700)
    // 保存した教室・その保存に含まれる分だけ(INV-08・保存の通信中に処理した分は次の保存へ)。
    expect(finalize).toContain('splitPendingParentAbsenceFinalize(pendingBefore, { classroomId: savedClassroomId, snapshotSavedAt })')
    // ★分割せずに全件渡すと、51 件でサーバーが invalid-argument で丸ごと拒否する。
    expect(finalize).toContain('chunkParentMessageIds(toFinalize)')
    expect(finalize).toContain("markParentMessagesNotifiedViaFunction({ classroomId: savedClassroomId, messageIds: chunk, stage: 'notified' })")
    // 失敗した分は保存待ちへ戻す(次の保存で再送)。
    expect(finalize).toContain('reduce(addPendingParentAbsenceFinalize, current)')
    // 'notified' を送るのは「何もしない」とここの 2 か所だけ。
    expect([...APP_TSX.matchAll(/stage: 'notified'/gu)]).toHaveLength(2)
  })

  it('教室データが丸ごと差し替わったら(boardMountKey)保存待ちと一過性コマンドを捨てる(休みが消えたのに処理済みにしない)', () => {
    const effectIndex = APP_TSX.indexOf('}, [boardMountKey, setPendingParentAbsenceFinalize])')
    expect(effectIndex).toBeGreaterThan(0)
    const effect = APP_TSX.slice(effectIndex - 400, effectIndex)
    expect(effect).toContain('setPendingParentAbsenceFinalize([])')
    expect(effect).toContain('setParentAbsenceRequest(null)')
  })

  it('盤面へ一過性コマンドと結果・配置終了のコールバックを渡す', () => {
    const mountIndex = APP_TSX.indexOf('<ScheduleBoardScreen')
    expect(mountIndex).toBeGreaterThan(0)
    const props = APP_TSX.slice(mountIndex, mountIndex + 1600)
    expect(props).toContain('parentAbsenceRequest={parentAbsenceRequest}')
    expect(props).toContain('onParentAbsenceRequestProcessed={handleParentAbsenceRequestProcessed}')
    expect(props).toContain('onParentAbsencePlacementSettled={handleParentAbsencePlacementSettled}')
  })

  it('通知モーダルは全画面共通のラッパーに置かれ、件数 0 の早期 return にも含まれている', () => {
    const usages = [...APP_TSX.matchAll(/<ParentMessagesModal/gu)]
    expect(usages).toHaveLength(1)
    const wrapperIndex = APP_TSX.indexOf('const renderWithSubmissionAcknowledgement = useCallback')
    const modalIndex = usages[0].index ?? 0
    expect(wrapperIndex).toBeGreaterThan(0)
    expect(modalIndex).toBeGreaterThan(wrapperIndex)
    // 早期 return の条件に保護者連絡が入っていないと、連絡だけが来たときモーダルが出ない。
    expect(APP_TSX).toContain('if (submissionAcknowledgements.length === 0 && parentMessageNotifications.length === 0 && !staleConflictBanner)')
    // useCallback の deps に通知・畳み状態・処理中・エラー・四択ハンドラが入っていないと、再描画されない。
    const depsIndex = APP_TSX.indexOf('}, [acknowledgeAllSubmissions, acknowledgeSubmissionEntry')
    expect(depsIndex).toBeGreaterThan(modalIndex)
    const deps = APP_TSX.slice(depsIndex, depsIndex + 500)
    for (const dep of ['parentMessageNotifications', 'isParentMessagesModalCollapsed', 'parentAbsenceBusyId', 'parentAbsenceErrors', 'handleParentAbsenceChoice']) {
      expect(deps).toContain(dep)
    }
  })

  it('ログアウト・ユーザー不在で休み連絡の状態を捨てる(別アカウントに他教室の生徒名を見せない)', () => {
    const logoutIndex = APP_TSX.indexOf('const logout = useCallback')
    expect(logoutIndex).toBeGreaterThan(0)
    expect(APP_TSX.slice(logoutIndex, logoutIndex + 1200)).toContain('resetParentAbsenceNoticeState()')
    const userEffectIndex = APP_TSX.indexOf('if (currentUserId) return')
    expect(userEffectIndex).toBeGreaterThan(0)
    expect(APP_TSX.slice(userEffectIndex, userEffectIndex + 200)).toContain('resetParentAbsenceNoticeState()')
  })

  it('基本データ画面へ教室ID・教室名・フラグ・発行/失効を渡し、OFF のときは発行口を渡さない', () => {
    const mountIndex = APP_TSX.indexOf('<BasicDataScreen')
    expect(mountIndex).toBeGreaterThan(0)
    const props = APP_TSX.slice(mountIndex, mountIndex + 1600)
    expect(props).toContain('classroomId={actingClassroomId}')
    expect(props).toContain('classroomName={actingClassroom?.name}')
    expect(props).toContain('parentPortalQrEnabled={parentPortalQrEnabled}')
    expect(props).toContain('onIssueParentPortalToken={parentPortalQrEnabled ? issueParentPortalToken : undefined}')
    expect(props).toContain('onRevokeParentPortalToken={parentPortalQrEnabled ? revokeParentPortalToken : undefined}')
  })
})

describe('保護者向け固定QRの配線(main.tsx)', () => {
  it('/p/{token} は App 本体を読み込まない軽量経路で、提出ページの後・配布用盤面の前に分岐する', () => {
    expect(MAIN_TSX).toContain("import { extractParentPortalToken } from './utils/parentPortalRoute'")
    expect(MAIN_TSX).toContain("const ParentPortalPage = lazy(() => import('./components/parent-portal/ParentPortalPage'))")
    const submissionBranch = MAIN_TSX.indexOf('} else if (submissionToken) {')
    const parentBranch = MAIN_TSX.indexOf('} else if (parentPortalToken) {')
    const boardShareBranch = MAIN_TSX.indexOf('} else if (boardShareToken) {')
    const appImport = MAIN_TSX.indexOf("import('./App')")
    expect(submissionBranch).toBeGreaterThan(0)
    expect(parentBranch).toBeGreaterThan(submissionBranch)
    expect(boardShareBranch).toBeGreaterThan(parentBranch)
    expect(appImport).toBeGreaterThan(boardShareBranch)
    // 提出ページの iOS 表示倍率調整(width=520 + zoom 0.7 の対)は保護者ページでは呼ばない
    // (片方だけ真似ると極小文字になる。device-width で普通のモバイル CSS を書く前提)。
    const parentBranchBody = MAIN_TSX.slice(parentBranch, boardShareBranch)
    expect(parentBranchBody).not.toContain('applySubmissionViewport()')
    expect(parentBranchBody).toContain('<ParentPortalPage token={parentPortalToken} />')
  })
})
