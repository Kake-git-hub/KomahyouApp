import { describe, expect, it } from 'vitest'

import {
  DEVELOPER_REPORT_NOTE_LIMIT,
  DEVELOPER_REPORT_TRACE_KINDS,
  DEVELOPER_REPORT_TRACE_LIMIT,
  buildDeveloperReportId,
  buildDeveloperReportStoragePath,
  normalizeDeveloperReport,
  normalizeDeveloperReportTrace,
  trimDeveloperReportTraceToBudget,
} from './developerReport'

const FALLBACK = '2026-09-04T03:00:00.000Z'

describe('developerReport(server): 操作痕跡の正規化', () => {
  it('クライアント(src/utils/operationTrace.ts)の種別一覧と一致する(片方だけ足すとサーバーが黙って捨てる)', () => {
    expect([...DEVELOPER_REPORT_TRACE_KINDS]).toEqual(['board-commit', 'board-rebuild', 'undo', 'redo', 'save', 'operation-event', 'schedule-message', 'navigation', 'auto'])
  })

  it('壊れた要素だけ捨て、残りは通す。上限超過は新しい方を残す', () => {
    const raw = [
      { at: '2026-09-04T01:00:00.000Z', kind: 'board-commit', summary: ' ok ' },
      { at: 'bad-date', kind: 'undo', summary: 'fallback time' },
      { at: '2026-09-04T01:00:00.000Z', kind: 'unknown-kind', summary: 'drop' },
      { at: '2026-09-04T01:00:00.000Z', kind: 'save', summary: '' },
      'not-an-object',
      null,
    ]
    expect(normalizeDeveloperReportTrace(raw, { fallbackIso: FALLBACK })).toEqual([
      { at: '2026-09-04T01:00:00.000Z', kind: 'board-commit', summary: 'ok' },
      { at: FALLBACK, kind: 'undo', summary: 'fallback time' },
    ])
    expect(normalizeDeveloperReportTrace('nope', { fallbackIso: FALLBACK })).toEqual([])

    const many = Array.from({ length: DEVELOPER_REPORT_TRACE_LIMIT + 5 }, (_, i) => ({ at: FALLBACK, kind: 'save', summary: `op-${i}` }))
    const normalized = normalizeDeveloperReportTrace(many, { fallbackIso: FALLBACK })
    expect(normalized).toHaveLength(DEVELOPER_REPORT_TRACE_LIMIT)
    expect(normalized[0]?.summary).toBe('op-5')
  })

  it('合計文字数の予算を超えたら古い方から落とす(Firestore 1MiB 対策)', () => {
    const entries = Array.from({ length: 10 }, () => ({ at: FALLBACK, kind: 'save' as const, summary: 'x'.repeat(100) }))
    const kept = trimDeveloperReportTraceToBudget(entries, 3 * (100 + 4 + FALLBACK.length))
    expect(kept).toHaveLength(3)
    expect(kept).toEqual(entries.slice(-3))
  })
})

describe('developerReport(server): 報告本体の正規化', () => {
  it('文字列を切り詰め、boolean/日時を検証し、教室 id は呼び出し側の値を使う', () => {
    const report = normalizeDeveloperReport({
      classroomId: 'attacker-supplied',
      source: 'schedule',
      note: `  ${'n'.repeat(DEVELOPER_REPORT_NOTE_LIMIT + 50)}  `,
      reportedAt: 'garbage',
      appVersion: '1.5.490',
      userAgent: 'ua',
      pageUrl: 'https://komahyouapp-prod.web.app/',
      screen: 'board',
      boardDirty: 'yes',
      lastSavedAt: '2026-09-04T02:00:00.000Z',
      recentOperations: [{ at: FALLBACK, kind: 'save', summary: 's' }],
      scheduleContext: { viewType: 'student', nested: { a: 1 } },
      snapshotPayload: { screen: 'board' },
    }, { classroomId: 'c1', fallbackIso: FALLBACK })
    expect(report.classroomId).toBe('c1')
    expect(report.source).toBe('schedule')
    expect(report.note).toHaveLength(DEVELOPER_REPORT_NOTE_LIMIT)
    expect(report.reportedAt).toBe(FALLBACK)
    expect(report.boardDirty).toBe(false)
    expect(report.lastSavedAt).toBe('2026-09-04T02:00:00.000Z')
    expect(report.recentOperations).toHaveLength(1)
    expect(report.scheduleContext).toEqual({ viewType: 'student' })
    expect(report.hasSnapshotPayload).toBe(true)
  })

  it('source が不明なら board、snapshotPayload が配列/欠落なら無し扱い', () => {
    const report = normalizeDeveloperReport({ source: 'x', snapshotPayload: [] }, { classroomId: 'c1', fallbackIso: FALLBACK })
    expect(report.source).toBe('board')
    expect(report.hasSnapshotPayload).toBe(false)
    expect(report.note).toBe('')
    expect(report.lastSavedAt).toBe('')
  })
})

describe('developerReport(server): id と Storage パス', () => {
  it('id は時刻由来＋乱数で、パスに使える文字だけ', () => {
    const id = buildDeveloperReportId('2026-09-04T03:04:05.678Z', 'ab/c?d1e2f3g4h5')
    expect(id).toBe('20260904-030405678-abcd1e2f')
    expect(buildDeveloperReportStoragePath('main', 'v8OZ7zH8vONNHjjYVcR1', id)).toBe(`developer-reports/main/v8OZ7zH8vONNHjjYVcR1/${id}.json.gz`)
  })

  it('パス区切りなどの危険な文字を含むセグメントは拒否する', () => {
    expect(() => buildDeveloperReportStoragePath('main/../x', 'c1', 'r1')).toThrow()
    expect(() => buildDeveloperReportStoragePath('main', 'c 1', 'r1')).toThrow()
    expect(() => buildDeveloperReportStoragePath('main', 'c1', '')).toThrow()
  })
})
