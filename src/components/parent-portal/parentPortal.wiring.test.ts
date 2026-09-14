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

  it('購読はフラグ ON かつ教室が開いているときだけ動き、cleanup で通知を捨てる(他教室の残留を防ぐ)', () => {
    const subscribeIndex = APP_TSX.indexOf('subscribeParentMessages(actingClassroomId')
    expect(subscribeIndex).toBeGreaterThan(0)
    const effect = APP_TSX.slice(Math.max(0, subscribeIndex - 600), subscribeIndex + 900)
    expect(effect).toContain('if (!isRemoteBackendEnabled || !actingClassroomId || !parentPortalQrEnabled) return')
    expect(effect).toContain('unsubscribe()')
    expect(effect).toContain('setParentMessageNotifications([])')
    // 生徒名は ref から読む(クロージャが古いと改名・教室切替で他人の名前が出る)。
    expect(effect).toContain('students: studentsRef.current')
  })

  it('「確認」は 50 件ずつに分けて送り、成功した分だけ通知を消す(失敗時は残して再試行できる)', () => {
    const confirmIndex = APP_TSX.indexOf('const confirmAllParentMessages = useCallback')
    expect(confirmIndex).toBeGreaterThan(0)
    const body = APP_TSX.slice(confirmIndex, confirmIndex + 1800)
    // ★分割せずに全件渡すと、未読 51 件でサーバーが invalid-argument で丸ごと拒否し、モーダルが詰む。
    expect(body).toContain('chunkParentMessageIds(messageIds)')
    expect(body).toContain('markParentMessagesNotifiedViaFunction({ classroomId, messageIds: chunk })')
    const awaitIndex = body.indexOf('await markParentMessagesNotifiedViaFunction')
    const filterIndex = body.indexOf('setParentMessageNotifications((current) => current.filter')
    expect(awaitIndex).toBeGreaterThan(0)
    expect(filterIndex).toBeGreaterThan(awaitIndex)
    expect(body).toContain('} catch (error) {')
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
    // useCallback の deps に通知と確認中フラグが入っていないと、新着で再描画されない。
    const depsIndex = APP_TSX.indexOf('}, [acknowledgeAllSubmissions, acknowledgeSubmissionEntry')
    expect(depsIndex).toBeGreaterThan(modalIndex)
    const deps = APP_TSX.slice(depsIndex, depsIndex + 400)
    expect(deps).toContain('parentMessageNotifications')
    expect(deps).toContain('isParentMessageConfirming')
    expect(deps).toContain('confirmAllParentMessages')
  })

  it('ログアウト・ユーザー不在で通知を捨てる(別アカウントに他教室の生徒名を見せない)', () => {
    const logoutIndex = APP_TSX.indexOf('const logout = useCallback')
    expect(logoutIndex).toBeGreaterThan(0)
    expect(APP_TSX.slice(logoutIndex, logoutIndex + 1200)).toContain('setParentMessageNotifications([])')
    const userEffectIndex = APP_TSX.indexOf('if (currentUserId) return')
    expect(userEffectIndex).toBeGreaterThan(0)
    expect(APP_TSX.slice(userEffectIndex, userEffectIndex + 200)).toContain('setParentMessageNotifications([])')
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
