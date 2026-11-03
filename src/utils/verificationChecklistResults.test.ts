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
  summarizeChecklistResultsByClassroom,
  formatChecklistRecordedAt,
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

  it('分割された送信の同じ part の再送は受付が新しい方を採用し、版違いは別グループで受付が早い順に並ぶ', () => {
    const merged = mergeChecklistReports([
      { reportId: 'new', version: '1.5.502', part: 1, total: 2, body: '- p-1 要改善: 直後', recordedAt: '2026-09-12T03:00:00.000Z', reportedAt: '', attachments: [] },
      { reportId: 'old', version: '1.5.502', part: 1, total: 2, body: '- p-1 OK', recordedAt: '2026-09-12T01:00:00.000Z', reportedAt: '', attachments: [] },
      { reportId: 'v2', version: '1.5.504', part: 1, total: 1, body: '- p-2 OK', recordedAt: '2026-09-12T02:00:00.000Z', reportedAt: '', attachments: [] },
    ])
    // 再送を採用した v1.5.502 の受付は 03:00 になるので、02:00 受付の v1.5.504 が先に並ぶ(グループの最も早い受付順)。
    expect(merged.map((entry) => entry.version)).toEqual(['1.5.504', '1.5.502'])
    expect(merged[1].reportIds).toEqual(['new'])
    expect(merged[1].body).toBe('- p-1 要改善: 直後')
  })

  it('1 通ものは受付ごとに別扱いで、項目ごとに送っても前に送った項目の結果が残る(2026-11-03 回帰防止)', () => {
    const summary = summarizeChecklistReports([
      { reportId: 'a', note: '[確認リスト v1.5.672]\n- tp-51 OK', recordedAt: '2026-11-03T01:00:00.000Z' },
      { reportId: 'b', note: '[確認リスト v1.5.672]\n- tp-57 要改善: 講師が消える', recordedAt: '2026-11-03T02:00:00.000Z' },
      { reportId: 'c', note: '[確認リスト v1.5.672]\n- tp-51 要改善: 送り直し', recordedAt: '2026-11-03T03:00:00.000Z' },
    ])
    const byId = Object.fromEntries(summary.items.map((item) => [item.itemId, item]))
    expect(Object.keys(byId).sort()).toEqual(['tp-51', 'tp-57'])
    expect(byId['tp-51']).toMatchObject({ result: 'needs-improvement', memo: '送り直し', reportIds: ['c'] })
    expect(byId['tp-57']).toMatchObject({ result: 'needs-improvement', memo: '講師が消える', reportIds: ['b'] })
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
    expect(summary.items).toEqual([{ itemId: 'x-1', result: 'ok', memo: '', version: '1.5.0', recordedAt: '2026-09-25T00:00:00.000Z', reportIds: ['r1'], attachments: [] }])
    expect(summary.otherNotes).toEqual([{ version: '1.5.0', recordedAt: '2026-09-25T00:00:00.000Z', note: 'ボタンの位置を左へ' }])
  })
})

describe('summarizeChecklistResults / summarizeChecklistReports', () => {
  it('項目 id ごとに最新結果だけを残し(後勝ち)、未確認は表に現れない', () => {
    const summary = summarizeChecklistResults([
      { version: '1.5.502', total: 1, receivedParts: [1], body: '- p-1 要改善: 高い\n- p-2 OK', reportIds: ['a'], attachments: [], firstRecordedAt: '2026-09-12T01:00:00.000Z', lastRecordedAt: '2026-09-12T01:00:00.000Z' },
      { version: '1.5.504', total: 1, receivedParts: [1], body: '- p-1 OK\nその他の気づき:\n次は文字を大きく', reportIds: ['b'], attachments: [], firstRecordedAt: '2026-09-12T02:00:00.000Z', lastRecordedAt: '2026-09-12T02:00:00.000Z' },
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
    expect(summary.items).toEqual([{ itemId: 't-1', result: 'ok', memo: '', version: '1.5.556', recordedAt: '2026-09-22T00:00:00.000Z', reportIds: ['c'], attachments: [] }])
  })
})

describe('summarizeChecklistResultsByClassroom(どの教室で確認済みか・2026-11-03)', () => {
  const reports = [
    { reportId: 'd1', classroomId: 'dev', classroomName: '開発用教室', classroomKind: 'development' as const, note: '[確認リスト v1.5.672]\n- tp-51 OK', recordedAt: '2026-11-03T01:00:00.000Z' },
    { reportId: 't1', classroomId: 'test', classroomName: 'テスト教室', classroomKind: 'sandbox' as const, note: '[確認リスト v1.5.672]\n- tp-51 要改善: 科目を変えると消える', recordedAt: '2026-11-03T02:00:00.000Z' },
    { reportId: 't2', classroomId: 'test', classroomName: 'テスト教室', classroomKind: 'sandbox' as const, note: '[確認リスト v1.5.672]\n- tp-57 OK', recordedAt: '2026-11-03T03:00:00.000Z' },
    // 開発用教室の古いまとめ送り(分割 2 通)も読める。
    { reportId: 'd0a', classroomId: 'dev', classroomName: '開発用教室', classroomKind: 'development' as const, note: '[確認リスト v1.5.672] (1/2)\n- jd-1 OK', recordedAt: '2026-11-02T01:00:00.000Z' },
    { reportId: 'd0b', classroomId: 'dev', classroomName: '開発用教室', classroomKind: 'development' as const, note: '[確認リスト v1.5.672] (2/2)\n- jd-2 要改善: 二重', recordedAt: '2026-11-02T01:00:01.000Z' },
  ]

  it('項目ごとに教室別の最新結果を返し、開発用教室を先に並べ、今の教室に印を付ける', () => {
    const results = summarizeChecklistResultsByClassroom(reports, { currentClassroomId: 'test' })
    expect(results['tp-51'].map((row) => [row.classroomLabel, row.result, row.isCurrentClassroom])).toEqual([
      ['開発用教室', 'ok', false],
      ['テスト教室', 'needs-improvement', true],
    ])
    expect(results['tp-51'][1].memo).toBe('科目を変えると消える')
    expect(results['tp-57'].map((row) => row.classroomKind)).toEqual(['sandbox'])
    expect(results['jd-1'][0]).toMatchObject({ classroomKind: 'development', result: 'ok' })
    expect(results['jd-2'][0]).toMatchObject({ classroomKind: 'development', result: 'needs-improvement', memo: '二重' })
  })

  it('同じ教室で同じ項目を送り直したら後勝ち(教室ごとに 1 行)', () => {
    const results = summarizeChecklistResultsByClassroom([
      ...reports,
      { reportId: 't3', classroomId: 'test', classroomName: 'テスト教室', classroomKind: 'sandbox' as const, note: '[確認リスト v1.5.672]\n- tp-51 OK', recordedAt: '2026-11-03T05:00:00.000Z' },
    ], { currentClassroomId: 'dev' })
    expect(results['tp-51'].filter((row) => row.classroomKind === 'sandbox')).toEqual([
      expect.objectContaining({ result: 'ok', recordedAt: '2026-11-03T05:00:00.000Z', isCurrentClassroom: false }),
    ])
  })

  it('テスト教室が複数あるときは教室名を添える', () => {
    const results = summarizeChecklistResultsByClassroom([
      { classroomId: 'a', classroomName: 'テストA', classroomKind: 'sandbox' as const, note: '[確認リスト v1.5.672]\n- x OK', recordedAt: '2026-11-03T01:00:00.000Z' },
      { classroomId: 'b', classroomName: 'テストB', classroomKind: 'sandbox' as const, note: '[確認リスト v1.5.672]\n- x OK', recordedAt: '2026-11-03T02:00:00.000Z' },
    ], { currentClassroomId: null })
    expect(results.x.map((row) => row.classroomLabel)).toEqual(['テスト教室(テストB)', 'テスト教室(テストA)'])
  })

  it('受付時刻は JST で短く出す', () => {
    expect(formatChecklistRecordedAt('2026-11-03T05:05:00.000Z')).toBe('11/3 14:05')
    expect(formatChecklistRecordedAt('')).toBe('')
  })
})
