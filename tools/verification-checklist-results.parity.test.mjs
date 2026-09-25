// 確認リスト結果の読み取りは 2 実装ある(tools の .mjs = PC から gcloud で読む従来ツール／
// src/utils/verificationChecklistResults.ts = 開発ダッシュボード)。判定規則が食い違うと
// 「ツールでは要改善なのにダッシュボードでは未回答」のような取り違えが起きるため、同じ入力で両者の出力が
// 一致することをここで固定する(作法は functions/src/*.parity.test.ts と同じ)。
import { describe, expect, it } from 'vitest'

import {
  mergeChecklistReports as mergeMjs,
  parseChecklistBody as parseBodyMjs,
  parseChecklistMarker as parseMarkerMjs,
  summarizeChecklistResults as summarizeMjs,
  toChecklistReport as toReportMjs,
} from './verification-checklist-report.lib.mjs'

const FIXTURE_NOTES = [
  '[確認リスト v1.5.556]\n- b-2 要改善: 今日の盤面からも消してほしい\n- t-1 OK\n- その他: 文字をもっと大きく',
  '[確認リスト v1.5.555] (1/2)\n- r-2 OK\n- r-5 要改善: 休日解除で席に戻らない',
  '[確認リスト v1.5.555] (2/2)\nその他の気づき:\n元の授業の振替先日が追いついていません\n日程表は問題ない',
  '[確認リスト v1.5.555] (1/2)\n- r-2 要改善: 再送前',
  '講師日程表にも電話番号の欄がほしい',
  '[確認リスト v1.5.556] (3/2)\n- 壊れたマーカー',
]

const FIXTURE_REPORTS = FIXTURE_NOTES.map((note, index) => ({
  reportId: `r${index}`,
  note,
  recordedAt: `2026-09-2${index}T00:00:00.000Z`,
  reportedAt: `2026-09-2${index}T00:00:00.000Z`,
}))

describe('確認リスト結果の読み取り: .mjs と TS の一致', () => {
  it('マーカー・本文抽出・結合・項目集約のすべてで同じ結果になる', async () => {
    const ts = await import('../src/utils/verificationChecklistResults.ts')
    for (const note of FIXTURE_NOTES) {
      expect(ts.parseChecklistMarker(note), note).toEqual(parseMarkerMjs(note))
    }
    const tsParts = FIXTURE_REPORTS.map((report) => ts.toChecklistReport(report)).filter(Boolean)
    const mjsParts = FIXTURE_REPORTS.map((report) => toReportMjs(report)).filter(Boolean)
    // .mjs は documentPath も返すが、TS 側は持たない(ダッシュボードでは使わない)。それ以外は一致。
    expect(tsParts).toEqual(mjsParts.map(({ documentPath: _documentPath, ...rest }) => rest))
    const tsMerged = ts.mergeChecklistReports(tsParts)
    const mjsMerged = mergeMjs(mjsParts)
    expect(tsMerged).toEqual(mjsMerged)
    for (const merged of tsMerged) {
      expect(ts.parseChecklistBody(merged.body)).toEqual(parseBodyMjs(merged.body))
    }
    expect(ts.summarizeChecklistResults(tsMerged)).toEqual(summarizeMjs(mjsMerged))
    expect(ts.summarizeChecklistReports(FIXTURE_REPORTS)).toEqual(summarizeMjs(mjsMerged))
  })
})
