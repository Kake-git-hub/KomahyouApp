// 確認リスト結果の読み取り(TS 移植)の回帰防止テスト。
// tools/verification-checklist-report.test.mjs と同じ観点を TS 側でも固定する
// (両実装の突き合わせは tools/verification-checklist-results.parity.test.mjs)。

import { describe, expect, it } from 'vitest'

import {
  mergeChecklistReports,
  parseChecklistBody,
  parseChecklistMarker,
  summarizeChecklistReports,
  summarizeChecklistResults,
  toChecklistReport,
} from './verificationChecklistResults'
import { buildVerificationChecklistReportNotes, createEmptyVerificationChecklistDraft } from './verificationChecklist'

describe('parseChecklistMarker', () => {
  it('単一送信・分割送信のマーカーを認識し、マーカー無しと壊れた分割番号は null', () => {
    expect(parseChecklistMarker('[確認リスト v1.5.502]\n- p-1 OK')).toEqual({ version: '1.5.502', part: 1, total: 1 })
    expect(parseChecklistMarker('[確認リスト v1.5.502] (2/3)')).toEqual({ version: '1.5.502', part: 2, total: 3 })
    expect(parseChecklistMarker('9/3 の振替が消えた')).toBeNull()
    expect(parseChecklistMarker('[確認リスト v1.5.502] (3/2)')).toBeNull()
    expect(parseChecklistMarker(null)).toBeNull()
  })
})

describe('toChecklistReport / mergeChecklistReports', () => {
  it('マーカー行を除いた本文を取り出し、分割は part 順に結合する(受付順が逆でも)', () => {
    const second = toChecklistReport({ reportId: 'b', note: '[確認リスト v1.5.502] (2/2)\n- p-2 要改善: 行が高い', recordedAt: '2026-09-12T01:00:00.000Z' })
    const first = toChecklistReport({ reportId: 'a', note: '[確認リスト v1.5.502] (1/2)\n- p-1 OK', recordedAt: '2026-09-12T02:00:00.000Z' })
    expect(first?.body).toBe('- p-1 OK')
    const merged = mergeChecklistReports([second!, first!])
    expect(merged).toHaveLength(1)
    expect(merged[0].receivedParts).toEqual([1, 2])
    expect(merged[0].body).toBe('- p-1 OK\n- p-2 要改善: 行が高い')
    expect(merged[0].reportIds).toEqual(['a', 'b'])
    expect(merged[0].firstRecordedAt).toBe('2026-09-12T01:00:00.000Z')
    expect(merged[0].lastRecordedAt).toBe('2026-09-12T02:00:00.000Z')
  })

  it('同じ part の再送は受付が新しい方を採用し、版違いは別グループで受付が早い順に並ぶ', () => {
    const merged = mergeChecklistReports([
      { reportId: 'new', version: '1.5.502', part: 1, total: 1, body: '- p-1 要改善: 直後', recordedAt: '2026-09-12T03:00:00.000Z', reportedAt: '' },
      { reportId: 'old', version: '1.5.502', part: 1, total: 1, body: '- p-1 OK', recordedAt: '2026-09-12T01:00:00.000Z', reportedAt: '' },
      { reportId: 'v2', version: '1.5.504', part: 1, total: 1, body: '- p-2 OK', recordedAt: '2026-09-12T02:00:00.000Z', reportedAt: '' },
    ])
    // 再送を採用した v1.5.502 の受付は 03:00 になるので、02:00 受付の v1.5.504 が先に並ぶ(グループの最も早い受付順)。
    expect(merged.map((entry) => entry.version)).toEqual(['1.5.504', '1.5.502'])
    expect(merged[1].reportIds).toEqual(['new'])
    expect(merged[1].body).toBe('- p-1 要改善: 直後')
  })

  it('マーカーが無い報告(通常の要望・報告)は確認リストとして扱わない', () => {
    expect(toChecklistReport({ reportId: 'x', note: '講師日程表にも電話番号の欄がほしい' })).toBeNull()
  })
})

describe('parseChecklistBody', () => {
  it('OK / 要改善(メモつき・メモに : を含む) と「その他の気づき」の見出し形式・1 行形式を読む', () => {
    const body = ['- p-1 OK', '- p-2 要改善: 講師名: 見切れる', 'その他の気づき:', 'QR ボタンにスピナー', '- その他: テンプレ作成ボタンを左へ', '雑音'].join('\n')
    const parsed = parseChecklistBody(body)
    expect(parsed.items).toEqual([
      { itemId: 'p-1', result: 'ok', memo: '' },
      { itemId: 'p-2', result: 'needs-improvement', memo: '講師名: 見切れる' },
    ])
    // 1 行形式の直後は「その他」セクションを抜けるので、続く雑音は捨てる(.mjs と同じ挙動)。
    expect(parsed.otherNotes).toBe('QR ボタンにスピナー\nテンプレ作成ボタンを左へ')
  })

  it('アプリの送信本文(buildVerificationChecklistReportNotes)をそのまま読める', () => {
    const item = { id: 'x-1', area: 'A', title: 't', steps: ['s'], introducedIn: 'v1.5.0' }
    const draft = { ...createEmptyVerificationChecklistDraft('v1.5.0'), entries: { 'x-1': { status: 'ok' as const, memo: '' } }, otherNotes: 'ボタンの位置を左へ' }
    const notes = buildVerificationChecklistReportNotes(draft, { items: [item] })
    expect(notes).toHaveLength(1)
    const summary = summarizeChecklistReports([{ reportId: 'r1', note: notes[0], recordedAt: '2026-09-25T00:00:00.000Z' }])
    expect(summary.items).toEqual([{ itemId: 'x-1', result: 'ok', memo: '', version: '1.5.0', recordedAt: '2026-09-25T00:00:00.000Z', reportIds: ['r1'] }])
    expect(summary.otherNotes).toEqual([{ version: '1.5.0', recordedAt: '2026-09-25T00:00:00.000Z', note: 'ボタンの位置を左へ' }])
  })
})

describe('summarizeChecklistResults / summarizeChecklistReports', () => {
  it('項目 id ごとに最新結果だけを残し(後勝ち)、未確認は表に現れない', () => {
    const summary = summarizeChecklistResults([
      { version: '1.5.502', total: 1, receivedParts: [1], body: '- p-1 要改善: 高い\n- p-2 OK', reportIds: ['a'], firstRecordedAt: '2026-09-12T01:00:00.000Z', lastRecordedAt: '2026-09-12T01:00:00.000Z' },
      { version: '1.5.504', total: 1, receivedParts: [1], body: '- p-1 OK\nその他の気づき:\n次は文字を大きく', reportIds: ['b'], firstRecordedAt: '2026-09-12T02:00:00.000Z', lastRecordedAt: '2026-09-12T02:00:00.000Z' },
    ])
    const p1 = summary.items.find((item) => item.itemId === 'p-1')
    expect(p1).toMatchObject({ result: 'ok', version: '1.5.504', reportIds: ['b'] })
    expect(summary.items.map((item) => item.itemId).sort()).toEqual(['p-1', 'p-2'])
    expect(summary.otherNotes).toEqual([{ version: '1.5.504', recordedAt: '2026-09-12T02:00:00.000Z', note: '次は文字を大きく' }])
  })

  it('報告一覧からマーカー付きだけを集約する(通常の要望・報告は混ぜない)', () => {
    const summary = summarizeChecklistReports([
      { reportId: 'q', note: '休みにした生徒の振替先を後から変えるには？', recordedAt: '2026-09-20T00:00:00.000Z' },
      { reportId: 'c', note: '[確認リスト v1.5.556]\n- t-1 OK', recordedAt: '2026-09-22T00:00:00.000Z' },
    ])
    expect(summary.items).toEqual([{ itemId: 't-1', result: 'ok', memo: '', version: '1.5.556', recordedAt: '2026-09-22T00:00:00.000Z', reportIds: ['c'] }])
  })
})
