// 確認リストパネルの配線ガード(source-scan・2026-09-12)。
//
// ⚠️ 本番データ保護: 確認リストは**開発用教室だけ**の道具で、本番教室(日大前・緑が丘・薬円台)では
// 一切マウントしてはいけない。レンダリングを isActingDevelopmentClassroom の外へ出す変更を落とすため、
// App.tsx の字面で条件付けを固定する(描画テスト環境が無いのでソース走査で担保する。
// 作法は inv02-manual-edit-persistence.matrix.test.ts / SpecialSessionScreen.test.ts と同じ)。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { describe, expect, it } from 'vitest'

const APP_TSX = readFileSync(fileURLToPath(new URL('../../App.tsx', import.meta.url)), 'utf8')
const PANEL_TSX = readFileSync(fileURLToPath(new URL('./VerificationChecklistPanel.tsx', import.meta.url)), 'utf8')

describe('確認リストパネルの配線(App.tsx)', () => {
  it('VerificationChecklistPanel を import している', () => {
    expect(APP_TSX).toContain("import { VerificationChecklistPanel } from './components/developer-report/VerificationChecklistPanel'")
  })

  it('描画は isActingDevelopmentClassroom で条件付けされている(本番教室ではマウントしない)', () => {
    const usages = [...APP_TSX.matchAll(/<VerificationChecklistPanel/gu)]
    expect(usages).toHaveLength(1)
    const index = usages[0].index ?? 0
    // 直前の条件式に isActingDevelopmentClassroom が入っていること。
    const preceding = APP_TSX.slice(Math.max(0, index - 200), index)
    expect(preceding).toMatch(/isActingDevelopmentClassroom\s*\?\s*\(\s*$/u)
  })

  it('画面分岐の外側(renderWithSubmissionAcknowledgement)に置かれ、確認通知の有無に関わらず出る', () => {
    expect(APP_TSX).toContain('const verificationChecklistPanel = isActingDevelopmentClassroom ? (')
    // 早期 return 側と通常 return 側の両方に差し込まれている(片方だけだと画面によって消える)。
    const references = [...APP_TSX.matchAll(/\{verificationChecklistPanel\}/gu)]
    expect(references.length).toBeGreaterThanOrEqual(2)
  })

  it('送信は既存の「要望・報告」経路(source: board / category: request)を使う', () => {
    expect(APP_TSX).toContain("return submit({ source: 'board', category: 'request', note })")
    expect(APP_TSX).toContain('submitDeveloperReportRef.current = submitDeveloperReport')
  })
})

describe('確認リストパネル本体', () => {
  it('下書きは localStorage、送信は props 経由(独自の保存先・直送を作らない)', () => {
    expect(PANEL_TSX).toContain('window.localStorage')
    expect(PANEL_TSX).not.toMatch(/\bfetch\(/u)
    expect(PANEL_TSX).not.toContain('firebase')
  })

  it('書式・下書き・進捗の計算は純関数モジュールへ委譲している', () => {
    expect(PANEL_TSX).toContain("from '../../utils/verificationChecklist'")
    expect(PANEL_TSX).toContain('buildVerificationChecklistReportNotes')
    expect(PANEL_TSX).toContain('countVerificationChecklistProgress')
  })
})
