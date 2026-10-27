import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { describe, expect, it } from 'vitest'
import type { AppSnapshotPayload } from '../types/appState'
import { SNAPSHOT_TOO_LARGE_GUIDANCE_MESSAGE, SNAPSHOT_TOO_LARGE_GUIDANCE_WITHOUT_BACKUP_MESSAGE } from './saveProgressMessages'
import {
  buildUnsentCloudSaveFailurePrompt,
  buildUnsentCloudSaveReportBody,
  isUnsentCloudSaveRecord,
  resolveSaveFailureDialog,
  UNSENT_CLOUD_SAVE_PROMPT_TRANSIENT_FAILURE_COUNT,
  buildUnsentCloudSaveOpenPrompt,
  buildUnsentCloudSaveRecord,
  buildUnsentCloudSaveReportNote,
  isUnsentCloudSaveExpired,
  shouldClearUnsentCloudSaveOnSuccess,
  shouldPromptUnsentCloudSaveOnFailure,
  shouldPromptUnsentCloudSaveOnOpen,
  UNSENT_CLOUD_SAVE_MAX_AGE_MS,
  UNSENT_CLOUD_SAVE_REPORT_MARKER,
  UNSENT_CLOUD_SAVE_SESSION_ID,
} from './unsentCloudSave'

const NOW = Date.parse('2026-10-27T12:00:00.000Z')
const payload = { students: [], teachers: [] } as unknown as AppSnapshotPayload

function record(overrides: Partial<ReturnType<typeof buildUnsentCloudSaveRecord>> = {}) {
  return {
    ...buildUnsentCloudSaveRecord({
      classroomId: 'c1',
      classroomName: '教室A',
      snapshotSavedAt: '2026-10-26T12:15:05.000Z',
      error: new Error('INTERNAL'),
      appVersion: '1.5.648',
      payload,
      recentOperations: [{ at: '2026-10-26T12:00:00.000Z', kind: 'board-commit', summary: '机の変更' }],
      now: new Date('2026-10-26T12:15:20.000Z'),
    }),
    ...overrides,
  }
}

describe('保存できなかった内容の控え(2026-10-27 日大前校の保存失敗)', () => {
  it('控えは失敗した教室のデータ・理由・失敗時点までの操作痕跡・この画面の id を持つ', () => {
    const entry = record()
    expect(entry.classroomId).toBe('c1')
    expect(entry.sessionId).toBe(UNSENT_CLOUD_SAVE_SESSION_ID)
    expect(entry.errorMessage).toBe('INTERNAL')
    expect(entry.payload).toBe(payload)
    expect(entry.recentOperations).toHaveLength(1)
    expect(entry.failedAt).toBe('2026-10-26T12:15:20.000Z')
  })

  it('保存が成功したら、この画面で作った控えだけ消す(再読み込み後の成功では前の画面の控えを消さない)', () => {
    expect(shouldClearUnsentCloudSaveOnSuccess(record())).toBe(true)
    expect(shouldClearUnsentCloudSaveOnSuccess(record({ sessionId: 'previous-tab' }))).toBe(false)
    expect(shouldClearUnsentCloudSaveOnSuccess(null)).toBe(false)
  })

  it('教室を開いたときに案内するのは前の画面の控えで 14 日以内のものだけ', () => {
    expect(shouldPromptUnsentCloudSaveOnOpen(record({ sessionId: 'previous-tab' }), UNSENT_CLOUD_SAVE_SESSION_ID, NOW)).toBe(true)
    // この画面の控えは失敗したその場で案内済み
    expect(shouldPromptUnsentCloudSaveOnOpen(record(), UNSENT_CLOUD_SAVE_SESSION_ID, NOW)).toBe(false)
    expect(shouldPromptUnsentCloudSaveOnOpen(null, UNSENT_CLOUD_SAVE_SESSION_ID, NOW)).toBe(false)
    const old = record({ sessionId: 'previous-tab', failedAt: new Date(NOW - UNSENT_CLOUD_SAVE_MAX_AGE_MS - 1).toISOString() })
    expect(isUnsentCloudSaveExpired(old, NOW)).toBe(true)
    expect(shouldPromptUnsentCloudSaveOnOpen(old, UNSENT_CLOUD_SAVE_SESSION_ID, NOW)).toBe(false)
    expect(isUnsentCloudSaveExpired(record({ failedAt: 'broken' }), NOW)).toBe(true)
  })

  it('失敗したその場の案内は、この画面・この教室で初回だけ(自動保存の失敗が続いても何度も聞かない)', () => {
    const prompted = new Set<string>()
    expect(shouldPromptUnsentCloudSaveOnFailure(prompted, 'c1')).toBe(true)
    prompted.add('c1')
    expect(shouldPromptUnsentCloudSaveOnFailure(prompted, 'c1')).toBe(false)
    expect(shouldPromptUnsentCloudSaveOnFailure(prompted, 'c2')).toBe(true)
    expect(shouldPromptUnsentCloudSaveOnFailure(prompted, '')).toBe(false)
  })

  it('案内文: その場は従来の案内＋問い、次回は失敗時刻(JST)と教室名。開発用語を出さない', () => {
    const failure = buildUnsentCloudSaveFailurePrompt('保存に失敗しました。接続を確認して、もう一度「保存」してください。')
    expect(failure).toContain('開発者へ送りますか？')
    const open = buildUnsentCloudSaveOpenPrompt(record())
    expect(open).toContain('10/26 21:15')
    expect(open).toContain('「教室A」')
    expect(open).toContain('次回また表示します')
    for (const text of [failure, open]) expect(text).not.toMatch(/Firebase|Firestore|IndexedDB|データベース|ブラウザ/u)
  })

  it('報告の一言: 先頭に印・失敗時刻・理由・版。生徒名は入れない(メール・Issue に載る)', () => {
    const note = buildUnsentCloudSaveReportNote(record({ payload: { students: [{ name: '生徒A' }] } as unknown as AppSnapshotPayload }), 'on-open')
    expect(note.startsWith(UNSENT_CLOUD_SAVE_REPORT_MARKER)).toBe(true)
    expect(note).toContain('次に開いたときに送信')
    expect(note).toContain('理由: INTERNAL')
    expect(note).toContain('版 1.5.648')
    expect(note).not.toContain('生徒A')
    expect(buildUnsentCloudSaveReportNote(record(), 'on-failure')).toContain('失敗したその場で送信')
  })
})

describe('保存失敗のダイアログの出し分け(resolveSaveFailureDialog・regression-reviewer 2026-10-27)', () => {
  const base = {
    guidance: '保存に失敗しました。接続を確認して、もう一度「保存」してください。\nバックアップをダウンロード済みです。',
    guidanceWithoutBackup: '保存に失敗しました。接続を確認して、もう一度「保存」してください。',
    downloadedBackup: false,
    record: { classroomId: 'c1', classroomName: '教室A' },
    alreadyPrompted: false,
    isVisible: true,
    isTransient: false,
    consecutiveFailures: 1,
  }

  it('一時的でない失敗(容量超過など)は初回で「開発者へ送りますか？」を聞く。教室名つき', () => {
    const dialog = resolveSaveFailureDialog(base)
    expect(dialog.type).toBe('confirm')
    if (dialog.type === 'confirm') {
      expect(dialog.text).toContain('「教室A」の保存できなかった内容を開発者へ送りますか？')
      expect(dialog.text).not.toContain('ダウンロード済み')
    }
  })

  it('★容量超過の自動保存の失敗でも「閉じず、再読み込みもしない」は残し、「ダウンロード済み」だけを外す', () => {
    const dialog = resolveSaveFailureDialog({ ...base, guidance: SNAPSHOT_TOO_LARGE_GUIDANCE_MESSAGE, guidanceWithoutBackup: SNAPSHOT_TOO_LARGE_GUIDANCE_WITHOUT_BACKUP_MESSAGE })
    expect(dialog.type).toBe('confirm')
    if (dialog.type === 'confirm') {
      expect(dialog.text).toContain('再読み込みもしないでください')
      expect(dialog.text).not.toContain('ダウンロード済み')
    }
    expect(SNAPSHOT_TOO_LARGE_GUIDANCE_WITHOUT_BACKUP_MESSAGE).toBe(SNAPSHOT_TOO_LARGE_GUIDANCE_MESSAGE.replace('（内容はダウンロード済みです）', ''))
  })

  it('一瞬の回線切れ(一時的な失敗)は 3 回続くまで聞かない。ダウンロードしていれば従来の案内(alert)', () => {
    expect(UNSENT_CLOUD_SAVE_PROMPT_TRANSIENT_FAILURE_COUNT).toBe(3)
    expect(resolveSaveFailureDialog({ ...base, isTransient: true, consecutiveFailures: 2 }).type).toBe('none')
    expect(resolveSaveFailureDialog({ ...base, isTransient: true, consecutiveFailures: 2, downloadedBackup: true })).toEqual({ type: 'alert', text: base.guidance })
    expect(resolveSaveFailureDialog({ ...base, isTransient: true, consecutiveFailures: 3 }).type).toBe('confirm')
  })

  it('聞くのはこの画面・この教室で 1 回だけ。隠れたタブでは聞かない(戻るまで自動保存を止めない)。控えが無ければ聞かない', () => {
    expect(resolveSaveFailureDialog({ ...base, alreadyPrompted: true }).type).toBe('none')
    expect(resolveSaveFailureDialog({ ...base, alreadyPrompted: true, downloadedBackup: true }).type).toBe('alert')
    expect(resolveSaveFailureDialog({ ...base, isVisible: false }).type).toBe('none')
    expect(resolveSaveFailureDialog({ ...base, record: null, downloadedBackup: true })).toEqual({ type: 'alert', text: base.guidance })
  })
})

describe('開発者へ送る報告の本文(buildUnsentCloudSaveReportBody)', () => {
  it('送り先は控えの教室・保護者用QRのトークンは外す・痕跡は控えの分・種類は不具合', () => {
    const entry = record({ payload: { students: [{ id: 's1', name: '生徒A', parentPortalToken: 'secret-token' }], teachers: [] } as unknown as AppSnapshotPayload })
    const body = buildUnsentCloudSaveReportBody(entry, { trigger: 'on-open', appVersion: '1.5.648', userAgent: 'UA', pageUrl: 'https://example.test/' })
    expect(body.classroomId).toBe('c1')
    expect(body.category).toBe('bug')
    expect(body.note.startsWith(UNSENT_CLOUD_SAVE_REPORT_MARKER)).toBe(true)
    expect(body.recentOperations).toHaveLength(1)
    expect(body.lastSavedAt).toBe(entry.snapshotSavedAt)
    expect(JSON.stringify(body.snapshotPayload)).not.toContain('secret-token')
    // 元の控えは書き換えない
    expect(JSON.stringify(entry.payload)).toContain('secret-token')
  })

  it('壊れた控えでも例外にしない(生徒が無い・痕跡が無い)', () => {
    const broken = { ...record(), payload: {} as AppSnapshotPayload, recentOperations: undefined as unknown as [] }
    expect(() => buildUnsentCloudSaveReportBody(broken, { trigger: 'on-failure', appVersion: '', userAgent: '', pageUrl: '' })).not.toThrow()
  })

  it('端末から読んだ控えの形を確かめる', () => {
    expect(isUnsentCloudSaveRecord(record())).toBe(true)
    expect(isUnsentCloudSaveRecord(null)).toBe(false)
    expect(isUnsentCloudSaveRecord({ classroomId: 'c1' })).toBe(false)
    expect(isUnsentCloudSaveRecord({ ...record(), payload: null })).toBe(false)
  })
})

describe('App.tsx の配線(ソース走査)', () => {
  const app = readFileSync(fileURLToPath(new URL('../App.tsx', import.meta.url)), 'utf8')

  it('保存の失敗点(教室ごとの catch)で控えを書き、成功点で同じ画面の控えを消す', () => {
    expect(app).toMatch(/recordOperationTrace\('save', `保存失敗: [\s\S]*?failedUnsentRecord = buildUnsentCloudSaveRecord\([\s\S]*?void writeUnsentCloudSave\(failedUnsentRecord\)/u)
    // 成功点(markOperationTraceSaved の後・break の前)。保護者QRの配線テストの範囲を崩さないよう break の直前に置く。
    expect(app).toMatch(/markOperationTraceSaved\(targetClassroom\.id, operationTrace\)[\s\S]{0,1600}void clearUnsentCloudSaveIfSameSession\(targetClassroom\.id\)\s*\r?\n\s*consecutiveCloudSaveFailuresRef\.current\.delete\(targetClassroom\.id\)\s*\r?\n\s*break/u)
  })

  it('失敗したその場の出し分けは純関数 resolveSaveFailureDialog。版数衝突は控えない(別の案内がある)', () => {
    expect(app).toContain('const failureDialog = resolveSaveFailureDialog({')
    expect(app).toContain("if (window.confirm(failureDialog.text)) void sendUnsentCloudSaveRef.current?.(unsentRecord, 'on-failure')")
    expect(app).toContain('window.alert(failureDialog.text)')
    expect(app).toContain('if (!isStaleSnapshotConflictError(error)) {')
    // 控えを書くのは保存の失敗点の 1 か所だけ
    expect(app.split('writeUnsentCloudSave(').length - 1).toBe(1)
  })

  it('送信は「質問・要望」と同じ経路(submitDeveloperReportViaFunction)で、保護者用QRのトークンを外し、送れたら控えを消す', () => {
    const body = app.slice(app.indexOf('const sendUnsentCloudSave = useCallback('), app.indexOf('sendUnsentCloudSaveRef.current = sendUnsentCloudSave'))
    expect(body).toContain('buildUnsentCloudSaveReportBody(record, {')
    expect(body).toContain('submitDeveloperReportViaFunction(body)')
    expect(body).toContain('deleteUnsentCloudSaveIfUnchanged(record.classroomId, record.failedAt)')
    // 保存の通信が終わってから送る(遅い回線で次の保存を時間切れにしない)
    expect(body).toContain('remoteSaveInFlightRef.current && waited < 60')
    // 本文づくりも try の中(壊れた控えで unhandled rejection にしない)
    expect(body.indexOf('try {')).toBeLessThan(body.indexOf('buildUnsentCloudSaveReportBody('))
  })

  it('★控えは盤面へ書き戻さない(起動時は常にサーバー最新が正・v1.5.405 の撤去を復活させない)。開いたときは送るかを聞くだけ', () => {
    const effect = app.slice(app.indexOf('const checkedUnsentCloudSaveClassroomIdsRef'), app.indexOf('// 確認リストのパネル(上で定義)から最新の submitDeveloperReport を呼べるようにする。'))
    expect(effect).toContain('shouldPromptUnsentCloudSaveOnOpen(record)')
    expect(effect).toContain("sendUnsentCloudSaveRef.current?.(record, 'on-open')")
    for (const forbidden of ['applyWorkspaceSnapshot', 'applySnapshot', 'setBoardState', 'saveWorkspaceSnapshot', 'queueFirebaseWorkspaceSync']) {
      expect(effect, forbidden).not.toContain(forbidden)
    }
    // 控えの読み出しは開いたときの案内の 1 か所だけ。控えの教室データ(payload)を App は直接触らない(送る本文は純関数の中)
    expect(app.split('readUnsentCloudSave(').length - 1).toBe(1)
    expect(app).not.toMatch(/(record|unsentRecord|failedUnsentRecord)\.payload/u)
  })
})
