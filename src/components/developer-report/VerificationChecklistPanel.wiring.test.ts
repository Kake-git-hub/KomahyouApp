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

  it('項目の中の見出しは「準備」「やること」「OKの目安」(第62版・オーナー指示「確認リストの日本語が難しい」)', () => {
    expect(PANEL_TSX).toContain('<span className="verification-checklist-label">準備</span>')
    expect(PANEL_TSX).toContain('<div className="verification-checklist-label">やること</div>')
    expect(PANEL_TSX).toContain('<div className="verification-checklist-label">OKの目安</div>')
    for (const old of ['>前提<', '>操作<', '>見るところ<']) expect(PANEL_TSX).not.toContain(old)
  })

  it('送信は既存の「要望・報告」経路(source: board / category: request)を使う', () => {
    expect(APP_TSX).toContain("return submit({ source: 'board', category: 'request', note, attachments })")
    expect(APP_TSX).toContain('submitDeveloperReportRef.current = submitDeveloperReport')
  })
})

describe('確認リストパネル本体', () => {
  it('生徒名は App が開いている教室の生徒データから差し込む(ソースに実名を置かない・2026-10-10)', () => {
    expect(APP_TSX).toContain('resolveStudentName={resolveVerificationChecklistStudentName}')
    // 2026-10-15: 見る相手(開発用教室=全項目・テスト教室=テンプレ関係だけ)は App が台帳から決めて渡し、パネルは selectVerificationChecklistItems で絞る。
    expect(APP_TSX).toContain("audience={verificationChecklistAudience ?? 'sandbox'}")
    expect(APP_TSX).toContain('const verificationChecklistAudience = useMemo(() => resolveVerificationChecklistAudience(actingClassroom), [actingClassroom])')
    expect(PANEL_TSX).toContain('const items = useMemo(() => selectVerificationChecklistItems(audience), [audience])')
    expect(PANEL_TSX).toContain('countVerificationChecklistProgress(draft, items)')
    expect(PANEL_TSX).toContain('buildVerificationChecklistReportNotes(draft, { items })')
    expect(PANEL_TSX).toContain('buildVerificationChecklistMarkdown(draft, items)')
    expect(APP_TSX).toContain('const student = students.find((row) => row.id === studentId)')
    expect(PANEL_TSX).toContain('resolveVerificationChecklistText')
    expect(PANEL_TSX).toContain('resolveStudentName')
    for (const field of ['item.title', 'item.prep', 'step', 'line']) expect(PANEL_TSX).toContain(`{text(${field})}`)
  })

  it('下書きは localStorage、送信は props 経由(独自の保存先・直送を作らない)', () => {
    expect(PANEL_TSX).toContain('window.localStorage')
    expect(PANEL_TSX).not.toMatch(/\bfetch\(/u)
    expect(PANEL_TSX).not.toContain('firebase')
  })

  it('別タブ表示は同じパネルを createPortal で描くだけ(状態・送信経路を別タブ用に作らない・2026-10-14)', () => {
    expect(PANEL_TSX).toContain("import { createPortal } from 'react-dom'")
    expect(PANEL_TSX).toContain('createPortal(panel, detached.root)')
    expect(PANEL_TSX).toContain("from './verificationChecklistWindow'")
    // 元のタブが閉じる/再読み込みするときは別タブも閉じる(取り残された別タブの入力は届かない)。
    expect(PANEL_TSX).toContain("window.addEventListener('pagehide', closeWindow)")
  })

  it('書式・下書き・進捗の計算は純関数モジュールへ委譲している', () => {
    expect(PANEL_TSX).toContain("from '../../utils/verificationChecklist'")
    expect(PANEL_TSX).toContain('buildVerificationChecklistReportNotes')
    expect(PANEL_TSX).toContain('countVerificationChecklistProgress')
  })

  it('メモ欄は結果(要改善)に関わらず常に描画し、入力は setVerificationChecklistMemo を通す(2026-09-13)', () => {
    expect(PANEL_TSX).not.toContain("entry.status === 'needs-fix' || entry.memo ? (")
    expect(PANEL_TSX).toContain('updateDraft(setVerificationChecklistMemo(draft, item.id, event.target.value))')
  })
})
