import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  SAVE_CAPACITY_ALERT_MIN_INTERVAL_MS,
  SAVE_FAILURE_ALERT_COLLECTION,
  SAVE_FAILURE_ALERT_KINDS,
  SAVE_FAILURE_ALERT_MIN_INTERVAL_MS,
  SAVE_FAILURE_ALERT_SMTP_TIMEOUTS,
  SAVE_FAILURE_ALERT_TIMEOUT_MS,
  withTimeout,
  buildSaveFailureAlertMail,
  isSaveFailureAlertKind,
  resolveSaveFailureAlertThrottle,
  shouldSendSaveFailureAlert,
} from './saveFailureAlert'

const NOW = Date.parse('2026-10-22T07:00:00.000Z')

describe('shouldSendSaveFailureAlert(教室ごとに 1 時間に 1 通)', () => {
  it('間引きの仕様ロック: 1 時間', () => {
    expect(SAVE_FAILURE_ALERT_MIN_INTERVAL_MS).toBe(60 * 60 * 1000)
    expect(SAVE_FAILURE_ALERT_COLLECTION).toBe('saveFailureAlerts')
  })

  it('送信記録が無い・読めないなら送る。1 時間未満なら送らず、ちょうど 1 時間で送る', () => {
    expect(shouldSendSaveFailureAlert({ lastSentAtIso: null, nowMs: NOW })).toBe(true)
    expect(shouldSendSaveFailureAlert({ lastSentAtIso: 'bad', nowMs: NOW })).toBe(true)
    expect(shouldSendSaveFailureAlert({ lastSentAtIso: '2026-10-22T06:30:00.000Z', nowMs: NOW })).toBe(false)
    expect(shouldSendSaveFailureAlert({ lastSentAtIso: '2026-10-22T06:00:00.000Z', nowMs: NOW })).toBe(true)
    expect(shouldSendSaveFailureAlert({ lastSentAtIso: '2026-10-22T05:59:59.000Z', nowMs: NOW })).toBe(true)
  })

  it('未来の記録(時計ずれ)は送らない側に倒す。間隔は差し替えられる', () => {
    expect(shouldSendSaveFailureAlert({ lastSentAtIso: '2026-10-22T08:00:00.000Z', nowMs: NOW })).toBe(false)
    expect(shouldSendSaveFailureAlert({ lastSentAtIso: '2026-10-22T06:50:00.000Z', nowMs: NOW, minIntervalMs: 5 * 60 * 1000 })).toBe(true)
  })
})

describe('buildSaveFailureAlertMail', () => {
  const base = {
    workspaceKey: 'main',
    classroomId: 'cls1',
    classroomName: '教室A',
    saveId: 'save-abc',
    savedAt: '2026-10-22T06:58:00.000Z',
    occurredAt: '2026-10-22T06:58:03.000Z',
    updatedBy: 'uid-1',
    appVersion: '1.5.625',
    userAgent: 'Mozilla/5.0',
    projectId: 'komahyouapp-prod',
  }

  it('版数衝突: 件名に会社・教室・種類、本文に保存 ID・版数の詳細・確かめること・置き場所(JST 表記)', () => {
    const mail = buildSaveFailureAlertMail({ ...base, kind: 'stale-version', detail: 'サーバー版数=42 / 送信版数=40', occurrenceCount: 3 })
    expect(mail.subject).toBe('【保存失敗】[コマ表アプリ 監視] main / 教室A / 版数の衝突')
    expect(mail.text).toContain('会社(workspace): main')
    expect(mail.text).toContain('教室: 教室A (cls1)')
    expect(mail.text).toContain('保存 ID: save-abc')
    expect(mail.text).toContain('発生時刻: 2026-10-22 15:58:03 JST')
    expect(mail.text).toContain('詳細: サーバー版数=42 / 送信版数=40')
    expect(mail.text).toContain('発生回数(直近の通知以降を含む累計): 3')
    expect(mail.text).toContain('2 つの端末(またはタブ)で開いていないか')
    expect(mail.text).toContain('saveAttempts: workspaces/main/classroomSnapshots/cls1/saveAttempts/save-abc')
    expect(mail.text).toContain('classroom-save-history/main/cls1/')
    expect(mail.text).toContain('tools/snapshot-diff.mjs')
  })

  it('破壊防止ガードは saveAttempts に残らない旨を出し、教室名が無ければ ID で呼ぶ。detail・回数が無ければ行ごと出さない', () => {
    const mail = buildSaveFailureAlertMail({ ...base, classroomName: '', kind: 'data-loss-guard' })
    expect(mail.subject).toBe('【保存失敗】[コマ表アプリ 監視] main / cls1 / 空の管理データでの上書きを中止')
    expect(mail.text).toContain('(保存前に止めたので saveAttempts には残らない)')
    expect(mail.text).not.toContain('詳細:')
    expect(mail.text).not.toContain('発生回数(直近の通知以降を含む累計)')
  })

  it('読み戻し失敗はログと saveAttempts の errorMessage を指す', () => {
    const mail = buildSaveFailureAlertMail({ ...base, kind: 'readback-failed', detail: 'Firebase保存後の読み戻し検証に失敗しました。' })
    expect(mail.text).toContain('saveAttempts の errorMessage')
  })

  it('容量超過: 「保存が一切通らない・画面を閉じない」を確かめることに出し、件名は【保存失敗】', () => {
    const mail = buildSaveFailureAlertMail({ ...base, kind: 'snapshot-too-large', detail: '文書サイズ(見積もり)=1048601 / 上限=1048576' })
    expect(mail.subject.startsWith('【保存失敗】')).toBe(true)
    expect(mail.subject).toContain('教室データが 1 文書の上限(1MiB)を超えて保存できない'.split('(')[0])
    expect(mail.text).toContain('保存が一切通らない')
    expect(mail.text).toContain('文書サイズ(見積もり)=1048601')
  })

  it('上限が近い通知は件名【容量注意】・保存は成功している旨・1 日 1 通(失敗の文言を出さない)', () => {
    const mail = buildSaveFailureAlertMail({ ...base, kind: 'capacity-warning' })
    expect(mail.subject.startsWith('【容量注意】')).toBe(true)
    expect(mail.text).toContain('保存は成功しています')
    expect(mail.text).toContain('1 日 1 通')
    expect(mail.text).not.toContain('保存に失敗したため')
  })

  it('間引き: 失敗は教室ごとの文書で 1 時間、上限が近い通知は別の文書で 1 日(本物の失敗の通知を黙らせない)', () => {
    expect(resolveSaveFailureAlertThrottle('snapshot-too-large', 'c1')).toEqual({ docId: 'c1', minIntervalMs: SAVE_FAILURE_ALERT_MIN_INTERVAL_MS })
    expect(resolveSaveFailureAlertThrottle('write-failed', 'c1')).toEqual({ docId: 'c1', minIntervalMs: SAVE_FAILURE_ALERT_MIN_INTERVAL_MS })
    expect(resolveSaveFailureAlertThrottle('capacity-warning', 'c1')).toEqual({ docId: 'c1__capacity', minIntervalMs: SAVE_CAPACITY_ALERT_MIN_INTERVAL_MS })
    expect(SAVE_CAPACITY_ALERT_MIN_INTERVAL_MS).toBe(24 * 60 * 60 * 1000)
  })

  it('種類の一覧と判定', () => {
    expect([...SAVE_FAILURE_ALERT_KINDS]).toEqual(['stale-version', 'readback-failed', 'data-loss-guard', 'snapshot-too-large', 'write-failed', 'capacity-warning', 'snapshot-assembly-failed'])
    expect(isSaveFailureAlertKind('stale-version')).toBe(true)
    expect(isSaveFailureAlertKind('other')).toBe(false)
  })
})

describe('index.ts の配線(ソース走査)', () => {
  const indexTs = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
  const save = indexTs.slice(indexTs.indexOf('async function saveClassroomSnapshotFromCallable'), indexTs.indexOf('export const saveClassroomSnapshot = onCall('))

  it('保存の失敗点(破壊防止ガード・版数衝突・読み戻し失敗・容量超過・書き込み失敗)と上限が近いときにメールを送り、どれも await する', () => {
    expect(save).toContain("kind: 'data-loss-guard'")
    expect(save).toContain("kind: 'stale-version'")
    expect(save).toContain("kind: 'readback-failed'")
    expect(save).toContain("kind: 'snapshot-too-large'")
    expect(save).toContain("kind: 'write-failed'")
    expect(save).toContain("kind: 'capacity-warning'")
    expect(save.split('await notifySaveFailureByMail(').length - 1).toBe(6)
  })

  it('メールの失敗は保存の応答に影響させない(関数内で握る・throw しない)。待ち時間は 5 秒で打ち切り、SMTP にも上限を付ける(M-1)', () => {
    const body = indexTs.slice(indexTs.indexOf('async function notifySaveFailureByMail('), indexTs.indexOf('async function saveClassroomSnapshotFromCallable'))
    expect(body).toContain('catch (error)')
    expect(body).not.toContain('throw')
    expect(body).toContain('withTimeout(notifySaveFailureByMailUnbounded(params), SAVE_FAILURE_ALERT_TIMEOUT_MS, null)')
    expect(body).toContain('createTransport({ url: REPORT_MAIL_SMTP_URL, ...SAVE_FAILURE_ALERT_SMTP_TIMEOUTS })')
    // 破壊防止ガードのメールは failed-precondition(ガードが働いた)のときだけ(L-7)。元の例外は必ず投げ直す。
    expect(save).toContain("if (error instanceof HttpsError && error.code === 'failed-precondition') {")
    expect(save).toMatch(/kind: 'data-loss-guard',[\s\S]*?\}\)\s*\}\s*throw error/u)
    // 間引きの判定と発生回数の記録は教室ごとの文書(saveFailureAlerts/{classroomId})。
    expect(body).toContain('resolveSaveFailureAlertThrottle(params.kind, params.classroomId)')
    expect(body).toContain('.collection(SAVE_FAILURE_ALERT_COLLECTION).doc(throttle.docId)')
    expect(body).toContain('minIntervalMs: throttle.minIntervalMs')
    expect(body).toContain('shouldSendSaveFailureAlert(')
    expect(body).toContain('FieldValue.increment(1)')
  })
})

describe('withTimeout(メール通知の待ち時間の上限・M-1)', () => {
  it('時間内に終われば結果、過ぎたら fallback(例外にしない)。全体上限は保存の callable(120 秒)より十分短く、SMTP の各段より長い', async () => {
    expect(SAVE_FAILURE_ALERT_TIMEOUT_MS).toBe(5_000)
    expect(SAVE_FAILURE_ALERT_TIMEOUT_MS).toBeLessThan(120_000 / 4)
    for (const value of Object.values(SAVE_FAILURE_ALERT_SMTP_TIMEOUTS)) expect(value).toBeLessThanOrEqual(SAVE_FAILURE_ALERT_TIMEOUT_MS)
    await expect(withTimeout(Promise.resolve(true), 1_000, null)).resolves.toBe(true)
    const never = new Promise<boolean>(() => {})
    await expect(withTimeout(never, 10, null)).resolves.toBeNull()
    await expect(withTimeout(Promise.reject(new Error('x')), 1_000, null)).rejects.toThrow('x')
  })
})
