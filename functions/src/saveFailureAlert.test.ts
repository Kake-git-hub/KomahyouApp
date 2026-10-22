import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'

import {
  SAVE_FAILURE_ALERT_COLLECTION,
  SAVE_FAILURE_ALERT_KINDS,
  SAVE_FAILURE_ALERT_MIN_INTERVAL_MS,
  buildSaveFailureAlertMail,
  isSaveFailureAlertKind,
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

  it('種類の一覧と判定', () => {
    expect([...SAVE_FAILURE_ALERT_KINDS]).toEqual(['stale-version', 'readback-failed', 'data-loss-guard'])
    expect(isSaveFailureAlertKind('stale-version')).toBe(true)
    expect(isSaveFailureAlertKind('other')).toBe(false)
  })
})

describe('index.ts の配線(ソース走査)', () => {
  const indexTs = readFileSync(fileURLToPath(new URL('./index.ts', import.meta.url)), 'utf8')
  const save = indexTs.slice(indexTs.indexOf('async function saveClassroomSnapshotFromCallable'), indexTs.indexOf('export const saveClassroomSnapshot = onCall('))

  it('保存の 3 つの失敗点(破壊防止ガード・版数衝突・読み戻し失敗)でメールを送り、どれも throw の前に await する', () => {
    expect(save).toContain("kind: 'data-loss-guard'")
    expect(save).toContain("kind: 'stale-version'")
    expect(save).toContain("kind: 'readback-failed'")
    expect(save.split('await notifySaveFailureByMail(').length - 1).toBe(3)
  })

  it('メールの失敗は保存の応答に影響させない(関数内で握る・throw しない)', () => {
    const body = indexTs.slice(indexTs.indexOf('async function notifySaveFailureByMail('), indexTs.indexOf('async function saveClassroomSnapshotFromCallable'))
    expect(body).toContain('catch (error)')
    expect(body).not.toContain('throw')
    // 間引きの判定と発生回数の記録は教室ごとの文書(saveFailureAlerts/{classroomId})。
    expect(body).toContain('.collection(SAVE_FAILURE_ALERT_COLLECTION).doc(params.classroomId)')
    expect(body).toContain('shouldSendSaveFailureAlert(')
    expect(body).toContain('FieldValue.increment(1)')
  })
})
