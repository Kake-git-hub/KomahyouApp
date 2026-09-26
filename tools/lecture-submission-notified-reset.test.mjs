// QR 提出通知の「通知済み」を外すツールの純関数テスト(2026-09-26)。
// 書き込みは 1 件ずつ・教室一致・notifiedAt だけ、を固定する(本番データ保護・INV-07/INV-08)。
import { describe, it, expect } from 'vitest'
import { buildDeleteNotifiedRequest, buildSubmittedQuery, parseArgs, resolveApplyGuard, summarizeSubmission, validateArgs, wouldRenotifyAfterReset } from './lecture-submission-notified-reset.mjs'

describe('parseArgs / validateArgs', () => {
  it('workspace と classroom は必須(教室の既定値は無い)', () => {
    expect(validateArgs(parseArgs([]))).toEqual([
      '--workspace <key> は必須です。',
      '--classroom <教室ID> は必須です(教室を取り違えないため既定値は無い)。',
    ])
  })

  it('--apply は --token が無いと拒否(一括では外さない)', () => {
    const options = parseArgs(['--workspace', 'main', '--classroom', 'c1', '--apply'])
    expect(options.apply).toBe(true)
    expect(validateArgs(options)).toEqual(['--apply には --token <token> が必須です(1 件ずつしか外さない)。'])
  })

  it('token 付きなら通る。既定は dry-run(apply=false)', () => {
    const options = parseArgs(['--workspace', 'main', '--classroom', 'c1', '--token', 't1'])
    expect(options.apply).toBe(false)
    expect(validateArgs(options)).toEqual([])
  })
})

describe('buildSubmittedQuery', () => {
  it('App の購読と同じ where(classroomId ＝ かつ status=submitted)', () => {
    const query = buildSubmittedQuery('c1').structuredQuery
    expect(query.from).toEqual([{ collectionId: 'lectureSubmissions' }])
    expect(query.where.compositeFilter.filters.map((f) => [f.fieldFilter.field.fieldPath, f.fieldFilter.value.stringValue])).toEqual([
      ['classroomId', 'c1'],
      ['status', 'submitted'],
    ])
  })
})

describe('wouldRenotifyAfterReset(室長 PC の起動時通知の条件と同じ)', () => {
  it('提出が前回保存より後なら再通知される', () => {
    expect(wouldRenotifyAfterReset('2026-09-26T10:00:00.000Z', '2026-09-26T09:00:00.000Z')).toBe(true)
  })
  it('提出が前回保存より前(室長がその後に保存済み)なら外しても通知は出ない', () => {
    expect(wouldRenotifyAfterReset('2026-09-26T08:00:00.000Z', '2026-09-26T09:00:00.000Z')).toBe(false)
  })
  it('保存日時が不明なら出ない側に倒す(App と同じ氾濫防止)', () => {
    expect(wouldRenotifyAfterReset('2026-09-26T08:00:00.000Z', '')).toBe(false)
    expect(wouldRenotifyAfterReset(null, '2026-09-26T09:00:00.000Z')).toBe(false)
  })
})

describe('summarizeSubmission', () => {
  it('token・氏名・通知済み判定・再通知可否をまとめる', () => {
    const row = summarizeSubmission('projects/p/databases/(default)/documents/lectureSubmissions/tok1', {
      personType: { stringValue: 'teacher' },
      personName: { stringValue: '坂口' },
      sessionLabel: { stringValue: '冬期講習' },
      submittedAt: { stringValue: '2026-09-26T10:00:00.000Z' },
      notifiedAt: { stringValue: '2026-09-26T10:00:00.000Z' },
    }, '2026-09-26T09:00:00.000Z')
    expect(row).toMatchObject({ token: 'tok1', personType: 'teacher', personName: '坂口', notified: true, wouldRenotify: true })
  })
  it('notifiedAt が submittedAt と違う(再提出)なら通知済みではない', () => {
    const row = summarizeSubmission('x/tok2', { submittedAt: { stringValue: '2026-09-26T11:00:00.000Z' }, notifiedAt: { stringValue: '2026-09-26T10:00:00.000Z' } }, '')
    expect(row.notified).toBe(false)
  })
})

describe('buildDeleteNotifiedRequest(notifiedAt だけを部分更新で消す・INV-07)', () => {
  it('updateMask は notifiedAt のみ・本文は空(提出内容に触れない)', () => {
    const request = buildDeleteNotifiedRequest('komahyouapp-prod', 'tok 1')
    expect(request.method).toBe('PATCH')
    expect(request.url).toBe('https://firestore.googleapis.com/v1/projects/komahyouapp-prod/databases/(default)/documents/lectureSubmissions/tok%201?updateMask.fieldPaths=notifiedAt')
    expect(request.body).toEqual({ fields: {} })
  })
})

describe('resolveApplyGuard(書く前の安全確認・INV-08)', () => {
  it('doc が無ければ中止', () => {
    expect(resolveApplyGuard(undefined, 'c1').ok).toBe(false)
  })
  it('教室が一致しなければ中止(他教室の doc は触らない)', () => {
    const guard = resolveApplyGuard({ classroomId: { stringValue: 'c2' }, notifiedAt: { stringValue: 'x' } }, 'c1')
    expect(guard.ok).toBe(false)
    expect(guard.reason).toContain('教室が一致しない')
  })
  it('notifiedAt が無ければ中止(外すものが無い)', () => {
    expect(resolveApplyGuard({ classroomId: { stringValue: 'c1' } }, 'c1').ok).toBe(false)
  })
  it('教室一致 かつ notifiedAt あり なら実行できる', () => {
    expect(resolveApplyGuard({ classroomId: { stringValue: 'c1' }, notifiedAt: { stringValue: 'x' } }, 'c1')).toEqual({ ok: true, reason: '' })
  })
})
