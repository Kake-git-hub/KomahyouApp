// 処理中オーバーレイ(BusyOverlay)の回帰防止(2026-09-12・確認リスト v1.5.504 その他)。
// 描画は react-dom/server の静的レンダリングで確認し、盤面への配線(PDF 出力の開始/終了で対に更新)は
// ScheduleBoardScreen.tsx の字面で固定する(描画テスト環境が無いのでソース走査・作法は VerificationChecklistPanel.wiring.test.ts と同じ)。

import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it, vi } from 'vitest'

import { BusyOverlay } from './BusyOverlay'

vi.mock('html2canvas', () => ({ default: vi.fn() }))
vi.mock('jspdf', () => ({ default: class {} }))
const { resolveTemplateOverwriteReportLabels } = await import('../../utils/pdf')

const BOARD_TSX = readFileSync(fileURLToPath(new URL('../schedule-board/ScheduleBoardScreen.tsx', import.meta.url)), 'utf8')

describe('BusyOverlay', () => {
  it('message があればスピナーと文言を role=status で描画する', () => {
    const html = renderToStaticMarkup(<BusyOverlay message="PDF出力中…" />)
    expect(html).toContain('class="busy-overlay"')
    expect(html).toContain('role="status"')
    expect(html).toContain('aria-busy="true"')
    expect(html).toContain('class="busy-overlay-spinner"')
    expect(html).toContain('PDF出力中…')
  })

  it('message が空・null・未指定なら何も描画しない', () => {
    expect(renderToStaticMarkup(<BusyOverlay message="" />)).toBe('')
    expect(renderToStaticMarkup(<BusyOverlay message={null} />)).toBe('')
    expect(renderToStaticMarkup(<BusyOverlay />)).toBe('')
  })
})

describe('盤面(ScheduleBoardScreen)への配線', () => {
  it('BusyOverlay を import して描画している', () => {
    expect(BOARD_TSX).toContain("import { BusyOverlay } from '../common/BusyOverlay'")
    expect(BOARD_TSX).toContain('<BusyOverlay message={busyOverlayMessage} />')
  })

  it('盤面 PDF 出力は開始で文言を立て、finally で必ず消す(失敗しても残らない)', () => {
    const body = BOARD_TSX.slice(BOARD_TSX.indexOf('const runPrintPdf = async'), BOARD_TSX.indexOf('const handlePrintPdf = async'))
    expect(body).toContain("setBusyOverlayMessage('PDF出力中… しばらくお待ちください')")
    const finallyIndex = body.indexOf('} finally {')
    expect(finallyIndex).toBeGreaterThan(0)
    expect(body.slice(finallyIndex)).toContain('setBusyOverlayMessage(null)')
  })

  it('テンプレ上書きレポートの PDF 出力も同じオーバーレイを finally で消す', () => {
    const body = BOARD_TSX.slice(BOARD_TSX.indexOf('const handleTemplateSaveConfirm = async'), BOARD_TSX.indexOf('const handleTemplateClear ='))
    // 文言は 1c975ad で pdf.ts の resolveTemplateOverwriteReportLabels へ移った(差分反映の教室は見出し違い)。文言そのものは下の it で固定する。
    expect(body).toContain('setBusyOverlayMessage(resolveTemplateOverwriteReportLabels(templateReportMode).busyMessage)')
    const finallyIndex = body.indexOf('} finally {')
    expect(finallyIndex).toBeGreaterThan(0)
    expect(body.slice(finallyIndex)).toContain('setBusyOverlayMessage(null)')
  })

  it('テンプレ保存前レポートのオーバーレイ文言(上書き/差分反映の両方とも「PDF 出力中」と分かる)', () => {
    expect(resolveTemplateOverwriteReportLabels('overwrite').busyMessage).toBe('上書き内容のレポートを PDF 出力中… しばらくお待ちください')
    expect(resolveTemplateOverwriteReportLabels('diff').busyMessage).toBe('テンプレ保存前の盤面を PDF 出力中… しばらくお待ちください')
  })
})
