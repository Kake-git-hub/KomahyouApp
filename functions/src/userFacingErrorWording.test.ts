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
