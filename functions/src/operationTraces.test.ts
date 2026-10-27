import { describe, expect, it } from 'vitest'

import { DEVELOPER_REPORT_TRACE_SUMMARY_LIMIT } from './developerReport'
import { buildOperationTraceDoc, normalizeSaveOperationTrace, OPERATION_TRACE_SAVE_LIMIT } from './operationTraces'

const FALLBACK = '2026-10-22T06:00:00.000Z'

describe('normalizeSaveOperationTrace(保存に相乗りした操作痕跡・案 2)', () => {
  it('報告と同じ規則で正規化する: 種別外・空の要約・入れ子は捨て、時刻が壊れていれば受領時刻で埋める', () => {
    const result = normalizeSaveOperationTrace([
      { at: '2026-10-22T05:59:00.000Z', kind: 'board-commit', summary: ' 10/22 3限 机1: 空 → 青木 ' },
      { at: 'bad', kind: 'undo', summary: '取り消し' },
      { at: '2026-10-22T05:59:00.000Z', kind: 'unknown-kind', summary: 'x' },
      { at: '2026-10-22T05:59:00.000Z', kind: 'save', summary: '   ' },
      'junk',
      null,
    ], { fallbackIso: FALLBACK })
    expect(result).toEqual([
      { at: '2026-10-22T05:59:00.000Z', kind: 'board-commit', summary: '10/22 3限 机1: 空 → 青木' },
      { at: FALLBACK, kind: 'undo', summary: '取り消し' },
    ])
  })

  it('上限(300 件)を超えたら新しい方を残す。配列でなければ空', () => {
    const many = Array.from({ length: OPERATION_TRACE_SAVE_LIMIT + 20 }, (_, index) => ({ at: FALLBACK, kind: 'navigation', summary: `op-${index}` }))
    const result = normalizeSaveOperationTrace(many, { fallbackIso: FALLBACK })
    expect(result).toHaveLength(OPERATION_TRACE_SAVE_LIMIT)
    expect(result[result.length - 1]?.summary).toBe(`op-${OPERATION_TRACE_SAVE_LIMIT + 19}`)
    expect(normalizeSaveOperationTrace(undefined, { fallbackIso: FALLBACK })).toEqual([])
    expect(normalizeSaveOperationTrace({ not: 'array' }, { fallbackIso: FALLBACK })).toEqual([])
  })

  it('要約は報告と同じ長さで切る', () => {
    const [entry] = normalizeSaveOperationTrace([{ at: FALLBACK, kind: 'auto', summary: 'x'.repeat(DEVELOPER_REPORT_TRACE_SUMMARY_LIMIT + 50) }], { fallbackIso: FALLBACK })
    expect(entry?.summary).toHaveLength(DEVELOPER_REPORT_TRACE_SUMMARY_LIMIT)
  })
})

describe('buildOperationTraceDoc', () => {
  const entries = [
    { at: '2026-10-22T05:50:00.000Z', kind: 'board-commit' as const, summary: 'A' },
    { at: '2026-10-22T05:55:00.000Z', kind: 'save' as const, summary: 'B' },
  ]

  it('保存 1 回分の文書: 版数・実行者・端末情報・件数・最初と最後の時刻・サーバー受領時刻を持つ', () => {
    const doc = buildOperationTraceDoc({
      classroomId: 'c1',
      saveId: 'save-1',
      savedAt: '2026-10-22T05:56:00.000Z',
      snapshotVersion: 42,
      updatedBy: 'uid-1',
      client: { appVersion: '1.5.625', userAgent: 'UA' },
      entries,
      recordedAt: FALLBACK,
    })
    expect(doc).toEqual({
      classroomId: 'c1',
      saveId: 'save-1',
      savedAt: '2026-10-22T05:56:00.000Z',
      snapshotVersion: 42,
      updatedBy: 'uid-1',
      appVersion: '1.5.625',
      userAgent: 'UA',
      entries,
      entryCount: 2,
      firstAt: '2026-10-22T05:50:00.000Z',
      lastAt: '2026-10-22T05:55:00.000Z',
      recordedAt: FALLBACK,
    })
  })

  it('版数が無い(旧文書)なら null、端末情報が空なら項目ごと付けない、空の痕跡でも落ちない', () => {
    const doc = buildOperationTraceDoc({ classroomId: 'c1', saveId: 's', savedAt: FALLBACK, snapshotVersion: undefined, updatedBy: 'u', client: { appVersion: '', userAgent: '' }, entries: [], recordedAt: FALLBACK })
    expect(doc.snapshotVersion).toBeNull()
    expect('appVersion' in doc).toBe(false)
    expect('userAgent' in doc).toBe(false)
    expect(doc.entryCount).toBe(0)
    expect(doc.firstAt).toBe('')
  })

  it('文書 1MiB の予算を超える痕跡は古い方から落とす(報告と同じ規則)', () => {
    // 2026-10-27 に要約の上限を 2000 字へ広げたので、最大長が並ぶと 300 件でも予算(20 万字)を超え、古い方から落ちる(新しい方は必ず残る)。
    const huge = Array.from({ length: 600 }, (_, index) => ({ at: FALLBACK, kind: 'board-commit' as const, summary: `${index}-${'x'.repeat(DEVELOPER_REPORT_TRACE_SUMMARY_LIMIT - 8)}` }))
    const doc = buildOperationTraceDoc({ classroomId: 'c1', saveId: 's', savedAt: FALLBACK, snapshotVersion: 1, updatedBy: 'u', entries: huge, recordedAt: FALLBACK })
    expect(doc.entryCount).toBeLessThan(600)
    expect(doc.entryCount).toBeGreaterThan(0)
    expect(doc.entries[doc.entries.length - 1]?.summary.startsWith('599-')).toBe(true)
  })
})
