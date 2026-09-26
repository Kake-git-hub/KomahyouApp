// QR提出通知(モーダル)の購読を「教室を開いているとき」だけに限る配線ガード(source-scan・2026-09-26)。
//
// オーナー報告(2026-09-26): 開発者画面(教室運営管理)を開いたら、講師の QR 提出モーダルが開発者画面に出た。
// 開発者は教室を開いていなくても actingClassroomId(最後に開いた教室)を持つため、App.tsx の購読 effect が
// 画面を見ずに走っていた。害は 2 つ:
//   (1) 室長向けの通知が開発者画面に出る(表示の取り違え)。
//   (2) 表示した提出を markLectureSubmissionsNotified が notifiedAt=submittedAt でサーバーへ記録するため、
//       本来の教室の PC が閉じていた提出は次回起動の通知(selectStartupSubmissionsToNotify)から外れ、
//       室長に通知が届かなくなる(提出データ自体は Cloud Functions が反映済みなので集計は消えない)。
// 描画テスト環境が無いので、落としやすい配線を App.tsx の字面で固定する(作法は parentPortal.wiring.test.ts と同じ)。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const APP_TSX = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8')

describe('QR提出通知の購読配線(App.tsx)', () => {
  it('購読の可否は shouldSubscribeClassroomNotifications(screen, role) から導く', () => {
    expect(APP_TSX).toContain('const isClassroomNotificationSubscriptionActive = shouldSubscribeClassroomNotifications(screen, currentUser?.role)')
  })

  it('QR提出の購読 effect は開発者画面では購読せず、残っていた通知を捨ててから抜ける', () => {
    const subscribeIndex = APP_TSX.indexOf('subscribeLectureSubmissions(actingClassroomId')
    expect(subscribeIndex).toBeGreaterThan(0)
    const head = APP_TSX.slice(Math.max(0, subscribeIndex - 700), subscribeIndex)
    const gateIndex = head.indexOf('if (!isClassroomNotificationSubscriptionActive) {')
    expect(gateIndex).toBeGreaterThan(0)
    const gate = head.slice(gateIndex, gateIndex + 400)
    expect(gate).toContain('setSubmissionAcknowledgements([])')
    expect(gate).toContain('return')
    // 既存のリモート/教室ガードは残す(片方だけにしない)。
    expect(head).toContain('if (!isRemoteBackendEnabled || !actingClassroomId) return')
  })

  it('QR提出の購読 effect の依存に購読可否が入っている(教室を開いたら購読が始まり、開発者画面へ戻ったら止まる)', () => {
    const subscribeIndex = APP_TSX.indexOf('subscribeLectureSubmissions(actingClassroomId')
    const tail = APP_TSX.slice(subscribeIndex)
    const depsIndex = tail.indexOf('return unsubscribe')
    expect(depsIndex).toBeGreaterThan(0)
    const deps = tail.slice(depsIndex, depsIndex + 300)
    expect(deps).toContain('isClassroomNotificationSubscriptionActive')
  })

  it('保護者からの休み連絡の購読も同じ可否で止める(兄弟監査: 同じ overlay 構造を流用しているため)', () => {
    const subscribeIndex = APP_TSX.indexOf('subscribeParentMessages(actingClassroomId')
    expect(subscribeIndex).toBeGreaterThan(0)
    const effect = APP_TSX.slice(Math.max(0, subscribeIndex - 600), subscribeIndex + 900)
    expect(effect).toContain('if (!isRemoteBackendEnabled || !actingClassroomId || !parentPortalQrEnabled || !isClassroomNotificationSubscriptionActive) return')
    expect(effect).toContain('isClassroomNotificationSubscriptionActive, isRemoteBackendEnabled, parentPortalQrEnabled, resetParentAbsenceNoticeState])')
  })

  it('表示した提出の通知済み記録(notifiedAt)は購読 effect の中だけから書く(開発者画面で先取り記録しない)', () => {
    const calls = APP_TSX.split('void markLectureSubmissionsNotified(').length - 1
    expect(calls).toBe(1)
    const callIndex = APP_TSX.indexOf('void markLectureSubmissionsNotified(')
    const subscribeIndex = APP_TSX.indexOf('subscribeLectureSubmissions(actingClassroomId')
    expect(callIndex).toBeGreaterThan(subscribeIndex)
  })

  it('通知済み記録は shouldRecordSubmissionNotified(ロール・開発用教室)で囲む(開発者は本番教室では表示だけ・2026-09-26)', () => {
    const callIndex = APP_TSX.indexOf('void markLectureSubmissionsNotified(')
    const before = APP_TSX.slice(Math.max(0, callIndex - 400), callIndex)
    expect(before).toContain('if (shouldRecordSubmissionNotified(currentUserRoleRef.current, isActingDevelopmentClassroomRef.current)) {')
    // ref は最新のロール・教室判定を映す(購読を張り直さずに読む)。
    expect(APP_TSX).toContain('currentUserRoleRef.current = currentUser?.role')
    expect(APP_TSX).toContain('isActingDevelopmentClassroomRef.current = isActingDevelopmentClassroom')
  })
})
