// 「質問・要望」への回答(docs/spec-developer-report.md §G-3 / §G-5・オーナー確定 2026-09-28)の配線ガード(source-scan)。
//
// 描画テスト環境が無いので、落としやすい配線を字面で固定する(作法は parentPortal.wiring.test.ts と同じ)。
//  - 室長側: App.tsx が自教室の reportAnswers を購読し(開発者画面では購読しない)、未読件数をツールバーのバッジへ、
//    履歴を同じモーダルへ渡す。既読は callable(サーバー記録)。**自動で開くモーダルは作らない**(オーナー確定 2026-09-28)。
//  - 書き込み経路: クライアントは Firestore 直書きをしない(callable 2 本だけ)。ルールは write:false。
//  - 開発者側: 回答は requireDeveloperMember の callable だけ。既読は requireClassroomAccessMember。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const read = (relative: string) => readFileSync(fileURLToPath(new URL(relative, import.meta.url)), 'utf8')
const APP_TSX = read('../../App.tsx')
const STORE_TS = read('../../integrations/firebase/reportAnswersStore.ts')
const MODAL_TSX = read('./DeveloperReportModal.tsx')
const TOOLBAR_TSX = read('../schedule-board/BoardToolbar.tsx')
const BOARD_SCREEN_TSX = read('../schedule-board/ScheduleBoardScreen.tsx')
const ANSWER_SCREEN_TSX = read('../developer-admin/DeveloperReportAnswerScreen.tsx')
const ADMIN_SCREEN_TSX = read('../developer-admin/DeveloperAdminScreen.tsx')
const FUNCTIONS_INDEX = read('../../../functions/src/index.ts')
const RULES = read('../../../firebase/firestore.rules')

describe('質問・要望への回答: 室長側の配線(App.tsx)', () => {
  it('reportAnswers を購読し、開発者画面では購読しない(shouldSubscribeClassroomNotifications の結果で条件付け)', () => {
    expect(APP_TSX).toContain("import { markReportAnswersReadViaFunction, subscribeReportAnswers } from './integrations/firebase/reportAnswersStore'")
    expect(APP_TSX).toContain('if (!isRemoteBackendEnabled || !actingClassroomId || !isClassroomNotificationSubscriptionActive) return')
    expect(APP_TSX).toContain('const unsubscribe = subscribeReportAnswers(actingClassroomId, (entries) => {')
    // 教室切替・ログアウトで前の教室の質問文を残さない(INV-08)
    expect(APP_TSX).toContain('unsubscribe()\r\n      setReportAnswerEntries([])')
    expect(APP_TSX).toContain('setSubmissionAcknowledgements([])\r\n    setReportAnswerEntries([])')
  })

  it('未読件数はツールバーの「質問・要望」バッジへ、履歴は同じモーダルへ渡す(自動で開くモーダルは作らない)', () => {
    expect(APP_TSX).toContain('reportAnswerUnreadCount={unreadReportAnswerCount}')
    expect(APP_TSX).toContain('answers={isRemoteBackendEnabled ? reportAnswers : undefined}')
    expect(APP_TSX).toContain('onMarkAnswersRead={handleMarkReportAnswersRead}')
    // 教室分離: doc の classroomId でも絞る
    expect(APP_TSX).toContain('selectReportAnswersForClassroom(reportAnswerEntries, actingClassroomId)')
    // 回答通知のためだけの新しい overlay / モーダルを増やしていない(バッジ＋既存モーダルの履歴タブ)
    expect(APP_TSX).not.toContain('ReportAnswersModal')
  })

  it('既読はサーバー記録(callable)。開発者が本番教室を開いているときは記録しない(室長のバッジを消さない)', () => {
    expect(APP_TSX).toContain('const canMarkReportAnswersRead = shouldRecordSubmissionNotified(currentUser?.role, isActingDevelopmentClassroom)')
    expect(APP_TSX).toContain('if (!shouldRecordSubmissionNotified(currentUserRoleRef.current, isActingDevelopmentClassroomRef.current)) return')
    expect(APP_TSX).toContain('void markReportAnswersReadViaFunction({ classroomId, reportIds })')
    expect(APP_TSX).toContain('canMarkAnswersRead={canMarkReportAnswersRead}')
    expect(APP_TSX).not.toContain("localStorage.setItem('report-answers")
  })

  it('ScheduleBoardScreen → BoardToolbar へ未読件数を通し、ボタンの中にバッジを描く', () => {
    expect(BOARD_SCREEN_TSX).toContain('reportAnswerUnreadCount={reportAnswerUnreadCount}')
    expect(TOOLBAR_TSX).toContain("import { formatReportAnswerBadge } from '../../utils/reportAnswers'")
    expect(TOOLBAR_TSX).toContain('data-testid="board-report-developer-badge"')
    expect(TOOLBAR_TSX).toContain('className="toolbar-inline-count report-developer-badge"')
  })

  it('モーダルは履歴タブを持ち、未読だけに「確認しました」を出す(canMarkAnswersRead が偽なら出さない)', () => {
    expect(MODAL_TSX).toContain('resolveDeveloperReportModalInitialTab(unreadCount)')
    expect(MODAL_TSX).toContain('data-testid="developer-report-tab-history"')
    expect(MODAL_TSX).toContain("status === 'unread' && canMarkAnswersRead ?")
    expect(MODAL_TSX).toContain('data-testid="developer-report-mark-read"')
    expect(MODAL_TSX).toContain('sortReportAnswerEntries(answers)')
  })
})

describe('質問・要望への回答: 書き込み経路は Cloud Function だけ', () => {
  it('クライアントの store は firebase/firestore から読み取り用の関数だけを import する', () => {
    expect(STORE_TS).toContain("import { collection, limit, onSnapshot, orderBy, query } from 'firebase/firestore'")
    for (const forbidden of ['setDoc', 'updateDoc', 'deleteDoc', 'writeBatch', 'addDoc', 'runTransaction']) {
      expect(STORE_TS, forbidden).not.toContain(forbidden)
    }
    // orderBy は単一フィールド(reportedAt)だけ・where と組み合わせない(複合インデックス不要の形)
    expect(STORE_TS).toContain("orderBy('reportedAt', 'desc'),")
    expect(STORE_TS).not.toContain('where(')
    expect(STORE_TS).toContain("'markReportAnswersRead'")
    expect(STORE_TS).toContain("'answerDeveloperReport'")
  })

  it('開発者画面「質問への回答」は読み取り store と callable だけを使い、Firestore へ直接書かない', () => {
    expect(ADMIN_SCREEN_TSX).toContain("import { DeveloperReportAnswerScreen } from './DeveloperReportAnswerScreen'")
    expect(ADMIN_SCREEN_TSX).toContain('data-testid="developer-report-answers-toggle-button"')
    expect(ANSWER_SCREEN_TSX).toContain("import { listRecentDeveloperReports } from '../../integrations/firebase/developerReportsStore'")
    expect(ANSWER_SCREEN_TSX).toContain("import { answerDeveloperReportViaFunction, type AnswerDeveloperReportResult } from '../../integrations/firebase/reportAnswersStore'")
    expect(ANSWER_SCREEN_TSX).not.toContain("from 'firebase/firestore'")
    // 送る前に基準(§G-4)のチェックを通す
    expect(ANSWER_SCREEN_TSX).toContain('checkReportAnswerSubmit({ answer: draft, guidelinesConfirmed, currentAnswer: selected?.answerFinal ?? null })')
    expect(ANSWER_SCREEN_TSX).toContain('disabled={!submitCheck.ok || sending}')
  })

  it('Firestore ルール: reportAnswers は自教室メンバーのみ read・write は不可', () => {
    const start = RULES.indexOf('match /reportAnswers/{reportId} {')
    expect(start).toBeGreaterThan(0)
    const block = RULES.slice(start, RULES.indexOf('}', start + 'match /reportAnswers/{reportId} {'.length))
    expect(block).toContain('allow read: if canAccessClassroom(workspaceKey, classroomId);')
    expect(block).toContain('allow write: if false;')
  })

  it('サーバー: 送信時に回答待ち文書を作り(失敗しても報告は成功)、回答は開発者のみ、既読は教室メンバー', () => {
    expect(FUNCTIONS_INDEX).toContain("import { buildPendingReportAnswerDoc, normalizeAnswerDeveloperReportRequest, normalizeMarkReportAnswersReadRequest, planReportAnswerWrite, REPORT_ANSWERS_COLLECTION, resolveReportAnswerReadWrites, shouldCreateReportAnswerDoc, type ReportAnswerDoc } from './reportAnswers'")
    expect(FUNCTIONS_INDEX).toContain('if (shouldCreateReportAnswerDoc({ isTest: report.isTest, isVerificationChecklist })) {')
    expect(FUNCTIONS_INDEX).toContain('Failed to create pending reportAnswers doc')
    const answer = FUNCTIONS_INDEX.slice(FUNCTIONS_INDEX.indexOf('export const answerDeveloperReport'), FUNCTIONS_INDEX.indexOf('export const markReportAnswersRead'))
    expect(answer).toContain('await requireDeveloperMember(request.auth?.uid, workspaceKey)')
    expect(answer).toContain('batch.set(reportRef, plan.reportUpdate, { merge: true })')
    const markRead = FUNCTIONS_INDEX.slice(FUNCTIONS_INDEX.indexOf('export const markReportAnswersRead'), FUNCTIONS_INDEX.indexOf('export const deleteWorkspaceClassroom'))
    expect(markRead).toContain('await requireClassroomAccessMember(request.auth?.uid, workspaceKey, classroomId)')
    expect(markRead).toContain('resolveReportAnswerReadWrites(')
  })
})
