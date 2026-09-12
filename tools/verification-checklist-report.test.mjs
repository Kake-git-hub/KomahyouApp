// 「確認リスト」結果レポートの回帰防止テスト。
// 主目的: (1) マーカー無しの報告は除外する、(2) 分割(1/2, 2/2)を受付順に正しく結合する、
//         (3) 同一項目 id は後勝ち(最新結果)で集約する、(4) メモに `:` を含んでも正しくパースする。
import { describe, expect, it } from 'vitest'
import {
  parseChecklistMarker,
  toChecklistReport,
  mergeChecklistReports,
  parseChecklistBody,
  summarizeChecklistResults,
  buildChecklistMarkdown,
} from './verification-checklist-report.lib.mjs'

describe('parseChecklistMarker', () => {
  it('単一送信のマーカーを認識する', () => {
    expect(parseChecklistMarker('[確認リスト v1.5.502]\n- a OK')).toEqual({ version: '1.5.502', part: 1, total: 1 })
  })

  it('分割送信のマーカー (1/2) を認識する', () => {
    expect(parseChecklistMarker('[確認リスト v1.5.502] (1/2)\n- a OK')).toEqual({ version: '1.5.502', part: 1, total: 2 })
    expect(parseChecklistMarker('[確認リスト v1.5.502] (2/2)\n- b OK')).toEqual({ version: '1.5.502', part: 2, total: 2 })
  })

  it('マーカー無しの報告(通常の要望・報告)は null', () => {
    expect(parseChecklistMarker('9/3 の振替が消えた')).toBeNull()
    expect(parseChecklistMarker('')).toBeNull()
    expect(parseChecklistMarker(undefined)).toBeNull()
  })

  it('part が total を超える等の壊れたマーカーは null', () => {
    expect(parseChecklistMarker('[確認リスト v1.5.502] (3/2)')).toBeNull()
    expect(parseChecklistMarker('[確認リスト v1.5.502] (0/2)')).toBeNull()
  })
})

describe('toChecklistReport', () => {
  it('マーカー行を除いた本文を取り出す', () => {
    const report = toChecklistReport({ reportId: 'r1', documentPath: 'p/r1', note: '[確認リスト v1.5.502]\n- item-a OK\n- item-b 要改善: ずれる', recordedAt: '2026-09-12T00:00:00.000Z' })
    expect(report).toEqual({
      reportId: 'r1',
      documentPath: 'p/r1',
      version: '1.5.502',
      part: 1,
      total: 1,
      body: '- item-a OK\n- item-b 要改善: ずれる',
      recordedAt: '2026-09-12T00:00:00.000Z',
      reportedAt: '',
    })
  })

  it('マーカーが無ければ null(通常の要望・報告は確認リストとして扱わない)', () => {
    expect(toChecklistReport({ reportId: 'r2', note: '普通の報告です' })).toBeNull()
  })
})

describe('mergeChecklistReports', () => {
  it('同一版・同一 total の分割を part 順に結合する(受付は逆順で届いても結合順は part 順)', () => {
    const parts = [
      { version: '1.5.502', part: 2, total: 2, body: '- item-b OK', reportId: 'r2', recordedAt: '2026-09-12T00:10:00.000Z' },
      { version: '1.5.502', part: 1, total: 2, body: '- item-a OK', reportId: 'r1', recordedAt: '2026-09-12T00:00:00.000Z' },
    ]
    const merged = mergeChecklistReports(parts)
    expect(merged).toHaveLength(1)
    expect(merged[0].body).toBe('- item-a OK\n- item-b OK')
    expect(merged[0].receivedParts).toEqual([1, 2])
    expect(merged[0].reportIds).toEqual(['r1', 'r2'])
    expect(merged[0].firstRecordedAt).toBe('2026-09-12T00:00:00.000Z')
    expect(merged[0].lastRecordedAt).toBe('2026-09-12T00:10:00.000Z')
  })

  it('同一 part が再送されたら受付が新しい方を採用する', () => {
    const parts = [
      { version: '1.5.502', part: 1, total: 1, body: '- item-a 要改善: 旧メモ', reportId: 'r1', recordedAt: '2026-09-12T00:00:00.000Z' },
      { version: '1.5.502', part: 1, total: 1, body: '- item-a OK', reportId: 'r2', recordedAt: '2026-09-12T00:05:00.000Z' },
    ]
    const merged = mergeChecklistReports(parts)
    expect(merged).toHaveLength(1)
    expect(merged[0].body).toBe('- item-a OK')
    expect(merged[0].reportIds).toEqual(['r2'])
  })

  it('片方の part しか届いていなくても欠けたまま結合する', () => {
    const parts = [{ version: '1.5.502', part: 2, total: 2, body: '- item-b OK', reportId: 'r2', recordedAt: '2026-09-12T00:10:00.000Z' }]
    const merged = mergeChecklistReports(parts)
    expect(merged[0].receivedParts).toEqual([2])
    expect(merged[0].body).toBe('- item-b OK')
  })

  it('版違い・total違いは別グループとして結合し、グループは受付が早い順に並ぶ', () => {
    const parts = [
      { version: '1.5.502', part: 1, total: 1, body: '- item-a OK', reportId: 'r-new', recordedAt: '2026-09-12T02:00:00.000Z' },
      { version: '1.5.501', part: 1, total: 1, body: '- item-a 要改善: 旧版', reportId: 'r-old', recordedAt: '2026-09-11T00:00:00.000Z' },
    ]
    const merged = mergeChecklistReports(parts)
    expect(merged.map((entry) => entry.version)).toEqual(['1.5.501', '1.5.502'])
  })
})

describe('parseChecklistBody', () => {
  it('OK / 要改善(メモつき) の行と「その他の気づき」を分離する', () => {
    const body = [
      '- item-a OK',
      '- item-b 要改善: 印刷すると崩れる',
      'その他の気づき:',
      '講師画面の配色が見づらいです',
      '2行目のメモ',
    ].join('\n')
    const { items, otherNotes } = parseChecklistBody(body)
    expect(items).toEqual([
      { itemId: 'item-a', result: 'ok', memo: '' },
      { itemId: 'item-b', result: 'needs-improvement', memo: '印刷すると崩れる' },
    ])
    expect(otherNotes).toBe('講師画面の配色が見づらいです\n2行目のメモ')
  })

  it('メモに : を含んでも壊れない', () => {
    const { items } = parseChecklistBody('- item-c 要改善: 9:30 の枠で発生: 再現手順は不明')
    expect(items).toEqual([{ itemId: 'item-c', result: 'needs-improvement', memo: '9:30 の枠で発生: 再現手順は不明' }])
  })

  it('結果行でも気づき行でもない雑音は無視する', () => {
    const { items, otherNotes } = parseChecklistBody('見出し\n- item-a OK\n\n')
    expect(items).toEqual([{ itemId: 'item-a', result: 'ok', memo: '' }])
    expect(otherNotes).toBe('')
  })
})

describe('summarizeChecklistResults', () => {
  it('項目 id ごとに最新結果だけを残す(後勝ち)', () => {
    const merged = [
      { version: '1.5.500', total: 1, body: '- item-a OK', reportIds: ['r1'], lastRecordedAt: '2026-09-10T00:00:00.000Z' },
      { version: '1.5.502', total: 1, body: '- item-a 要改善: やっぱりだめ\n- item-b OK', reportIds: ['r2'], lastRecordedAt: '2026-09-12T00:00:00.000Z' },
    ]
    const summary = summarizeChecklistResults(merged)
    const byId = Object.fromEntries(summary.items.map((item) => [item.itemId, item]))
    expect(byId['item-a']).toMatchObject({ result: 'needs-improvement', memo: 'やっぱりだめ', version: '1.5.502' })
    expect(byId['item-b']).toMatchObject({ result: 'ok', version: '1.5.502' })
    expect(summary.items).toHaveLength(2)
  })

  it('未確認(一度も結果が来ていない)項目は表に現れない', () => {
    const merged = [{ version: '1.5.502', total: 1, body: '- item-a OK', reportIds: ['r1'], lastRecordedAt: '2026-09-12T00:00:00.000Z' }]
    const summary = summarizeChecklistResults(merged)
    expect(summary.items.map((item) => item.itemId)).toEqual(['item-a'])
  })

  it('その他の気づきは受付順に列挙する', () => {
    const merged = [
      { version: '1.5.500', total: 1, body: 'その他の気づき:\n最初の気づき', reportIds: ['r1'], lastRecordedAt: '2026-09-10T00:00:00.000Z' },
      { version: '1.5.502', total: 1, body: 'その他の気づき:\n2回目の気づき', reportIds: ['r2'], lastRecordedAt: '2026-09-12T00:00:00.000Z' },
    ]
    const summary = summarizeChecklistResults(merged)
    expect(summary.otherNotes.map((note) => note.note)).toEqual(['最初の気づき', '2回目の気づき'])
  })
})

describe('buildChecklistMarkdown', () => {
  it('要改善を先に、OK を後に、受付番号と日時つきで表にする', () => {
    const summary = {
      items: [
        { itemId: 'item-a', result: 'ok', memo: '', reportIds: ['r1'], recordedAt: '2026-09-12T00:00:00.000Z' },
        { itemId: 'item-b', result: 'needs-improvement', memo: '崩れる', reportIds: ['r2'], recordedAt: '2026-09-12T00:05:00.000Z' },
      ],
      otherNotes: [],
    }
    const markdown = buildChecklistMarkdown(summary)
    const bodyIndex = markdown.indexOf('item-b')
    const okIndex = markdown.indexOf('item-a')
    expect(bodyIndex).toBeGreaterThan(-1)
    expect(bodyIndex).toBeLessThan(okIndex)
    expect(markdown).toContain('| item-b | 要改善 | 崩れる | r2 | 2026-09-12T00:05:00.000Z |')
  })

  it('該当項目が無ければその旨を出す', () => {
    const markdown = buildChecklistMarkdown({ items: [], otherNotes: [] })
    expect(markdown).toContain('該当する確認リスト結果はありません')
  })

  it('その他の気づきセクションを出力する', () => {
    const markdown = buildChecklistMarkdown({ items: [], otherNotes: [{ version: '1.5.502', recordedAt: '2026-09-12T00:00:00.000Z', note: '配色が見づらい' }] })
    expect(markdown).toContain('## その他の気づき')
    expect(markdown).toContain('配色が見づらい')
  })
})
