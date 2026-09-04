// 「開発者へ報告」通知スクリプトの回帰防止テスト。
// 主目的: (1) 公開リポジトリの Issue 本文に操作痕跡(生徒名)や教室データを載せないこと、
//         (2) Firestore REST の値表現を正しく戻すこと、(3) 起票→notifiedAt 記録の順で二重起票を防ぐこと。
import { describe, expect, it } from 'vitest'
import {
  ISSUE_LABELS,
  buildLineMessage,
  sendLineNotification,
  buildIssueBody,
  buildIssueTitle,
  buildMarkNotifiedBody,
  buildRunQueryBody,
  decodeFirestoreValue,
  notifyPendingReports,
  parseRunQueryResponse,
} from './developer-report-notify.mjs'

const sampleFields = {
  reportId: { stringValue: '20260904-030405678-abcd1e2f' },
  classroomId: { stringValue: 'KzFnOQoTFLsCxwUp1tvh' },
  classroomName: { stringValue: 'スクールIE 緑が丘校' },
  source: { stringValue: 'schedule' },
  note: { stringValue: '9/3 の振替が消えた\n2行目' },
  reportedAt: { stringValue: '2026-09-04T03:04:05.678Z' },
  recordedAt: { stringValue: '2026-09-04T03:04:06.000Z' },
  appVersion: { stringValue: '1.5.490' },
  reporterRole: { stringValue: 'manager' },
  reporterEmail: { stringValue: 'secret@example.test' },
  boardDirty: { booleanValue: true },
  lastSavedAt: { stringValue: '2026-09-04T02:00:00.000Z' },
  recentOperationCount: { integerValue: '42' },
  recentOperations: { arrayValue: { values: [{ mapValue: { fields: { kind: { stringValue: 'board-commit' }, summary: { stringValue: '青木 太郎 を削除' } } } }] } },
  scheduleContext: { mapValue: { fields: { viewType: { stringValue: 'student' }, personLabel: { stringValue: '山田 花子' }, search: { stringValue: '' } } } },
  snapshotStoragePath: { stringValue: 'developer-reports/main/KzFnOQoTFLsCxwUp1tvh/20260904-030405678-abcd1e2f.json.gz' },
  notifiedAt: { nullValue: null },
}

describe('Firestore REST の値表現', () => {
  it('string/integer/boolean/null/array/map を戻す', () => {
    expect(decodeFirestoreValue({ stringValue: 'a' })).toBe('a')
    expect(decodeFirestoreValue({ integerValue: '42' })).toBe(42)
    expect(decodeFirestoreValue({ booleanValue: true })).toBe(true)
    expect(decodeFirestoreValue({ nullValue: null })).toBeNull()
    expect(decodeFirestoreValue({ arrayValue: { values: [{ stringValue: 'x' }] } })).toEqual(['x'])
    expect(decodeFirestoreValue({ mapValue: { fields: { k: { doubleValue: 1.5 } } } })).toEqual({ k: 1.5 })
    expect(decodeFirestoreValue(undefined)).toBeNull()
  })

  it('runQuery 応答は document を持つ行だけを受領時刻順に並べる', () => {
    const rows = [
      { readTime: 'x' },
      { document: { name: 'projects/p/databases/(default)/documents/workspaces/main/developerReports/b', fields: { ...sampleFields, recordedAt: { stringValue: '2026-09-04T05:00:00.000Z' } } } },
      { document: { name: 'projects/p/databases/(default)/documents/workspaces/main/developerReports/a', fields: sampleFields } },
    ]
    const reports = parseRunQueryResponse(rows)
    expect(reports.map((r) => r.documentPath.split('/').pop())).toEqual(['a', 'b'])
    expect(reports[0].recentOperationCount).toBe(42)
    expect(reports[0].boardDirty).toBe(true)
  })

  it('クエリは notifiedAt IS_NULL だけで絞り、複合インデックスを要求しない(orderBy 無し)', () => {
    const body = buildRunQueryBody()
    expect(body.structuredQuery.where.unaryFilter).toEqual({ op: 'IS_NULL', field: { fieldPath: 'notifiedAt' } })
    expect(body.structuredQuery.orderBy).toBeUndefined()
  })
})

describe('Issue の整形(公開リポジトリ前提)', () => {
  const report = parseRunQueryResponse([{ document: { name: 'projects/p/databases/(default)/documents/workspaces/main/developerReports/20260904-030405678-abcd1e2f', fields: sampleFields } }])[0]

  it('タイトルは教室名＋一言の先頭行', () => {
    expect(buildIssueTitle(report)).toBe('📣 [利用者報告] スクールIE 緑が丘校: 9/3 の振替が消えた')
    expect(buildIssueTitle({ ...report, note: '' })).toBe('📣 [利用者報告] スクールIE 緑が丘校')
  })

  it('本文にはメタと置き場所だけを載せ、操作痕跡の中身・メールアドレスは載せない', () => {
    const body = buildIssueBody(report)
    expect(body).toContain('スクールIE 緑が丘校')
    expect(body).toContain('日程表(別タブ)')
    expect(body).toContain('2026-09-04 12:04 JST')
    expect(body).toContain('1.5.490')
    expect(body).toContain('> 9/3 の振替が消えた\n> 2行目')
    expect(body).toContain('42 件')
    expect(body).toContain('viewType: student')
    expect(body).toContain('personLabel: 山田 花子')
    expect(body).not.toContain('search:')
    expect(body).toContain('workspaces/main/developerReports/20260904-030405678-abcd1e2f')
    expect(body).toContain('gs://komahyouapp-prod.firebasestorage.app/developer-reports/main/KzFnOQoTFLsCxwUp1tvh/20260904-030405678-abcd1e2f.json.gz')
    // 生徒名を含む操作痕跡とメールアドレスは公開 Issue に出さない。
    expect(body).not.toContain('青木 太郎')
    expect(body).not.toContain('secret@example.test')
    // 勝手に修正を始めない(オーナー指示 2026-09-04)。
    expect(body).toContain('勝手に修正を始めないこと')
    expect(body).toContain('許可してから')
  })

  it('LINE 通知文は教室・報告元・一言の先頭・Issue URL だけで、生徒名を含む痕跡は載せない', () => {
    const text = buildLineMessage(report, 'https://github.com/o/r/issues/77')
    expect(text).toContain('スクールIE 緑が丘校')
    expect(text).toContain('日程表(別タブ)')
    expect(text).toContain('一言: 9/3 の振替が消えた 2行目')
    expect(text).toContain('https://github.com/o/r/issues/77')
    expect(text).toContain('許可後')
    expect(text).not.toContain('青木 太郎')
    expect(buildLineMessage({ ...report, note: 'x'.repeat(100) }, 'u')).toContain('x'.repeat(80) + '…')
  })

  it('LINE は secrets 未設定なら送らず、失敗しても例外にしない(Issue 起票は成功済みのため)', async () => {
    expect(await sendLineNotification({ channelAccessToken: '', to: '', text: 't' })).toEqual({ sent: false, reason: 'not-configured' })
    const failing = async () => ({ ok: false, status: 401, text: async () => 'bad token' })
    expect(await sendLineNotification({ channelAccessToken: 'tok', to: 'U1', text: 't', fetchImpl: failing })).toEqual({ sent: false, reason: 'HTTP 401 bad token' })
    const calls = []
    const okFetch = async (url, init) => { calls.push({ url, body: JSON.parse(init.body), auth: init.headers.Authorization }); return { ok: true } }
    expect(await sendLineNotification({ channelAccessToken: 'tok', to: 'U1', text: 'hello', fetchImpl: okFetch })).toEqual({ sent: true })
    expect(calls[0].url).toBe('https://api.line.me/v2/bot/message/push')
    expect(calls[0].auth).toBe('Bearer tok')
    expect(calls[0].body).toEqual({ to: 'U1', messages: [{ type: 'text', text: 'hello' }] })
  })

  it('一言が空でも本文は成立し、教室データ未保存も明示する', () => {
    const body = buildIssueBody({ ...report, note: '', snapshotStoragePath: '' })
    expect(body).toContain('(空欄で送信)')
    expect(body).toContain('保存されていません')
    expect(body).not.toContain('gsutil')
  })

  it('notifiedAt/issueNumber/issueUrl を更新する PATCH 本文', () => {
    expect(buildMarkNotifiedBody(12, 'https://github.com/x/y/issues/12', '2026-09-04T04:00:00.000Z')).toEqual({
      fields: {
        notifiedAt: { stringValue: '2026-09-04T04:00:00.000Z' },
        issueNumber: { integerValue: '12' },
        issueUrl: { stringValue: 'https://github.com/x/y/issues/12' },
      },
    })
  })
})

describe('通知の一巡(fetch を注入)', () => {
  it('未通知の報告ごとに Issue を作り、その後に notifiedAt を埋める', async () => {
    const calls = []
    const fetchImpl = async (url, init) => {
      calls.push({ url, method: init.method, body: init.body ? JSON.parse(init.body) : null })
      if (url.endsWith(':runQuery')) {
        return { ok: true, json: async () => [{ document: { name: 'projects/p/databases/(default)/documents/workspaces/main/developerReports/r1', fields: sampleFields } }] }
      }
      if (url.includes('api.github.com')) {
        return { ok: true, json: async () => ({ number: 77, html_url: 'https://github.com/o/r/issues/77' }) }
      }
      return { ok: true, json: async () => ({}) }
    }
    const results = await notifyPendingReports({ projectId: 'p', workspaceKey: 'main', accessToken: 't', githubToken: 'g', repository: 'o/r', fetchImpl })
    expect(results).toEqual([{ reportId: '20260904-030405678-abcd1e2f', issueNumber: 77, issueUrl: 'https://github.com/o/r/issues/77', lineSent: false, lineReason: 'not-configured' }])
    expect(calls.map((c) => c.method)).toEqual(['POST', 'POST', 'PATCH'])
    expect(calls[1].body.labels).toEqual(ISSUE_LABELS)
    expect(calls[2].url).toContain('/workspaces/main/developerReports/r1?updateMask.fieldPaths=notifiedAt')
    expect(calls[2].body.fields.issueNumber).toEqual({ integerValue: '77' })
  })

  it('Firestore が失敗したら例外(ワークフロー赤)にして黙って成功にしない', async () => {
    const fetchImpl = async () => ({ ok: false, status: 403, text: async () => 'denied' })
    await expect(notifyPendingReports({ projectId: 'p', workspaceKey: 'main', accessToken: 't', githubToken: 'g', repository: 'o/r', fetchImpl })).rejects.toThrow('HTTP 403')
  })
})
