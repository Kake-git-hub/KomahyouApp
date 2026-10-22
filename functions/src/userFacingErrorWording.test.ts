import { readFileSync } from 'node:fs'
import { describe, expect, it } from 'vitest'

// 2026-10 アプリ内文言見直し(オーナー承認・文言一覧 #519〜#526)。
// サーバーのエラー文は室長の画面にそのまま出るため、Firebase / ワークスペース などの開発用語や
// 英語の内部エラー文を message に入れない。原因は logger と HttpsError の details に残す。
// エラーコード(unauthenticated / permission-denied / not-found / failed-precondition / internal)は変えない。
const source = readFileSync(new URL('./index.ts', import.meta.url), 'utf8')

describe('index.ts の利用者向けエラー文', () => {
  it('#522 未ログイン: 製品名を出さない(コードは unauthenticated のまま)', () => {
    expect(source).toContain("new HttpsError('unauthenticated', 'ログインしてください。')")
    expect(source).not.toContain('Firebase へログインしてください。')
  })

  it('#519 / #521 権限・教室なし: 「ワークスペース」を出さない(コードは permission-denied / not-found のまま)', () => {
    expect(source).toContain("new HttpsError('permission-denied', 'この教室を利用する権限がありません。')")
    expect(source).toContain("new HttpsError('not-found', 'この教室が見つかりません。')")
    expect(source).not.toContain('このワークスペースのメンバーではありません。')
    expect(source).not.toContain('この教室はこのワークスペースに存在しません。')
  })

  it('#523 空データ上書きの安全弁: 文言だけ平易にし、判定条件と件数の記録は残す', () => {
    const start = source.indexOf('async function assertNoSnapshotDataLoss(')
    const body = source.slice(start, source.indexOf('\n}\n', start))
    // ガード条件(回帰防止): 次が空・前回あり・前回件数 > 0 のときだけ止める。
    expect(body).toContain('if (nextManagementCount > 0) return')
    expect(body).toContain('if (!params.previousSnapshot) return')
    expect(body).toContain('if (previousManagementCount <= 0) return')
    expect(body).toContain("new HttpsError('failed-precondition', '中身が空のため、保存を中止しました。教室データを確認してください。', {")
    expect(body).toContain('previousManagementCount,')
    expect(body).not.toContain('Firebase上書き')
  })

  it('#524 読み戻し検証: 画面は平易な文言、保存記録には開発者向けの原因文を残す', () => {
    expect(source).toContain("new HttpsError('internal', '保存後の確認に失敗しました。もう一度保存してください。', { reason: 'readback-verification-failed' })")
    expect(source).toContain("errorMessage: 'Firebase保存後の読み戻し検証に失敗しました。'")
  })

  it('#525 / #526 想定外の例外: 画面の文言に原因(英文)を入れず、details.reason とログに残す', () => {
    expect(source).toContain("new HttpsError('internal', '履歴を読み込めませんでした。', { reason: message.slice(0, 300) })")
    expect(source).toContain("new HttpsError('internal', '処理できませんでした。時間をおいてお試しください。', { reason: message.slice(0, 300) })")
    expect(source).not.toContain('サーバーで履歴を読めませんでした(')
    expect(source).not.toContain('サーバーで処理できませんでした(')
    // 原因のログは消さない(INTERNAL しか返らない事故の再発防止・CLAUDE.md)。
    expect(source).toContain("logger.error('[getStudentLessonHistory] unexpected error', { message, stack:")
    expect(source).toContain('logger.error(`[${functionName}] unexpected error`, { message, stack:')
  })
})

describe('保存失敗の監視メール(2026-10-22 案 6)を足しても利用者向けの失敗応答は不変', () => {
  const save = source.slice(source.indexOf('async function saveClassroomSnapshotFromCallable'), source.indexOf('export const saveClassroomSnapshot = onCall('))

  it('版数衝突: failed-precondition と STALE_SNAPSHOT_ERROR_MARKER つきの全文がそのまま', () => {
    expect(save).toContain("`${STALE_SNAPSHOT_ERROR_MARKER}:別の端末でこの教室のデータが更新されています(サーバー版数=${versionDecision.previousVersion}/送信版数=${versionDecision.incomingBaseVersion})。最新を読み込むため、画面を再読み込みしてください。`")
    const conflict = save.slice(save.indexOf('if (!versionDecision.ok) {'), save.indexOf('const nextVersion = versionDecision.nextVersion'))
    expect(conflict.indexOf('await notifySaveFailureByMail(')).toBeLessThan(conflict.indexOf("throw new HttpsError(\n      'failed-precondition',"))
  })

  it('読み戻し失敗: internal と平易な文言がそのまま。メールは throw の前', () => {
    expect(save).toContain("throw new HttpsError('internal', '保存後の確認に失敗しました。もう一度保存してください。', { reason: 'readback-verification-failed' })")
    const readback = save.slice(save.indexOf("status: 'verification-failed',"), save.indexOf("reason: 'readback-verification-failed'"))
    expect(readback).toContain("kind: 'readback-failed'")
  })

  it('破壊防止ガード: catch は元の例外をそのまま投げ直す(文言・コードは assertNoSnapshotDataLoss のまま)', () => {
    const guard = save.slice(save.indexOf('await assertNoSnapshotDataLoss({'), save.indexOf('// A1: 楽観ロック'))
    expect(guard.trimEnd().endsWith('throw error\n  }')).toBe(true)
    expect(guard).not.toContain('new HttpsError(')
  })
})
